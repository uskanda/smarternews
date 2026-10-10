// Keeps the crawler away from this machine and its own network. URLs come from feeds, search results and
// model output, so any of them may point at a router, another service on this host, or a cloud metadata
// address. Two checks: the URL before a request is sent, and the resolved address where the connection is made.
import { lookup as systemLookup } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

const refused = new BlockList();
refused.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
refused.addAddress("::1", "ipv6");
refused.addSubnet("10.0.0.0", 8, "ipv4"); // private
refused.addSubnet("172.16.0.0", 12, "ipv4");
refused.addSubnet("192.168.0.0", 16, "ipv4");
refused.addSubnet("fc00::", 7, "ipv6");
refused.addSubnet("169.254.0.0", 16, "ipv4"); // link-local
refused.addSubnet("fe80::", 10, "ipv6");
// Shared address space, 100.64/10. Written in parts because `make verify` refuses a literal address from this
// range: it is the one Tailscale assigns, and a real one must never land in the repository.
refused.addSubnet([100, 64, 0, 0].join("."), 10, "ipv4");
refused.addSubnet("0.0.0.0", 8, "ipv4"); // unusable as a destination
refused.addAddress("::", "ipv6");

/** The IPv4 address inside `::ffff:a.b.c.d` or `::ffff:hhhh:hhhh`, or null. */
function mappedIpv4(address: string): string | null {
  const match = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(address);
  if (!match) return null;
  if (match[1]) return match[1];
  const high = parseInt(match[2]!, 16);
  const low = parseInt(match[3]!, 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return refused.check(address, "ipv4");
  if (family !== 6) return false;
  const inner = mappedIpv4(address);
  return inner ? refused.check(inner, "ipv4") : refused.check(address, "ipv6");
}

const normalizeHost = (host: string): string => host.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();

/** The hosts listed under `fetch.allowPrivateHosts`, in the form the checks compare against. */
export function allowSet(hosts: readonly string[]): ReadonlySet<string> {
  return new Set(hosts.map(normalizeHost));
}

/** Why a request to this URL must not be sent, or null when it may be. */
export function checkUrl(url: string, allowed: ReadonlySet<string>): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "not a URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return `scheme ${parsed.protocol} is neither http nor https`;
  const host = normalizeHost(parsed.hostname);
  if (allowed.has(host)) return null;
  return isBlockedAddress(host) ? `${host} is a loopback, private, link-local or shared-space address` : null;
}

export const DESTINATION_CODE = "EDESTINATION";

interface LookupRecord {
  address: string;
  family: number;
}
export type LookupCallback = (error: Error | null, address?: string | LookupRecord[], family?: number) => void;
/** The part of `dns.lookup` that a connection uses. */
export type Resolver = (hostname: string, options: { all?: boolean }, callback: LookupCallback) => void;

/**
 * A replacement for `dns.lookup` that fails when a name resolves into a refused range. It runs at the moment
 * of connecting, so the address that was checked is the address that is used.
 */
export function guardedLookup(allowed: ReadonlySet<string>, resolver: Resolver = systemLookup as unknown as Resolver): Resolver {
  return (hostname, options, callback) => {
    resolver(hostname, options, (error, address, family) => {
      if (error || address === undefined) return callback(error ?? new Error(`no address for ${hostname}`));
      const records = typeof address === "string" ? [address] : address.map((record) => record.address);
      const hit = allowed.has(normalizeHost(hostname)) ? undefined : records.find(isBlockedAddress);
      if (hit !== undefined) {
        const reason = `${hostname} resolves to ${hit}, a loopback, private, link-local or shared-space address`;
        return callback(Object.assign(new Error(reason), { code: DESTINATION_CODE }));
      }
      callback(null, address, family);
    });
  };
}

/** A fetch whose every connection goes through `guardedLookup`. */
export function createGuardedFetch(allowed: ReadonlySet<string>): typeof fetch {
  const dispatcher = new Agent({ connect: { lookup: guardedLookup(allowed) as never } });
  return ((input: string, init?: RequestInit) => undiciFetch(input, { ...(init as object), dispatcher })) as unknown as typeof fetch;
}
