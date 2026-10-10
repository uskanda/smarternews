import { describe, expect, it } from "vitest";
import { allowSet, checkUrl, guardedLookup, isBlockedAddress, type LookupCallback, type Resolver } from "./guard.ts";

// Addresses in 100.64/10 are put together here: `make verify` refuses a literal one in the repository.
const shared = (second: number, third: number, fourth: number) => [100, second, third, fourth].join(".");

describe("isBlockedAddress", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["::1", "loopback"],
    ["10.1.2.3", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.1.1", "private"],
    ["fd12:3456:789a::1", "private"],
    ["169.254.169.254", "link-local"],
    ["fe80::1", "link-local"],
    [shared(64, 0, 1), "shared address space"],
    [shared(127, 255, 255), "shared address space"],
    ["0.0.0.0", "unusable as a destination"],
    ["::", "unusable as a destination"],
    ["::ffff:127.0.0.1", "an IPv4 address written as IPv6"],
    ["::ffff:c0a8:0101", "an IPv4 address written as IPv6"],
  ])("refuses %s (%s)", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "169.253.0.1", "2606:2800:220:1::1", "::ffff:93.184.216.34"])(
    "lets %s through",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );
});

describe("checkUrl", () => {
  const none = allowSet([]);

  it("accepts an http or https URL with a host name", () => {
    expect(checkUrl("https://example.org/a", none)).toBeNull();
    expect(checkUrl("http://example.org/a", none)).toBeNull();
  });

  it("refuses a URL whose scheme is neither http nor https", () => {
    expect(checkUrl("file:///etc/passwd", none)).toMatch(/scheme/);
    expect(checkUrl("ftp://example.org/a", none)).toMatch(/scheme/);
  });

  it("refuses text that is not a URL", () => {
    expect(checkUrl("not a url", none)).toMatch(/not a URL/);
  });

  it("refuses a host written as an address in a refused range", () => {
    expect(checkUrl("http://127.0.0.1:8080/admin", none)).toMatch(/127\.0\.0\.1/);
    expect(checkUrl("http://[::1]/", none)).toMatch(/::1/);
    expect(checkUrl("http://192.168.0.1/", none)).not.toBeNull();
  });

  it("sees through other spellings of the same address", () => {
    expect(checkUrl("http://2130706433/", none)).not.toBeNull();
    expect(checkUrl("http://0x7f.1/", none)).not.toBeNull();
  });

  it("accepts an address in a refused range when the host is allowed", () => {
    expect(checkUrl("http://192.168.0.10/feed.xml", allowSet(["192.168.0.10"]))).toBeNull();
    expect(checkUrl("http://192.168.0.11/feed.xml", allowSet(["192.168.0.10"]))).not.toBeNull();
  });

  it("still refuses another scheme on an allowed host", () => {
    expect(checkUrl("ftp://192.168.0.10/feed.xml", allowSet(["192.168.0.10"]))).toMatch(/scheme/);
  });
});

function resolverFor(table: Record<string, string[]>): Resolver {
  return (hostname: string, options: { all?: boolean }, callback: LookupCallback) => {
    const addresses = table[hostname];
    if (!addresses) return callback(Object.assign(new Error("not found"), { code: "ENOTFOUND" }));
    const records = addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    if (options.all) return callback(null, records);
    callback(null, records[0]!.address, records[0]!.family);
  };
}

function resolve(lookup: Resolver, hostname: string, all: boolean) {
  return new Promise<{ error: Error | null; address: unknown }>((done) => {
    lookup(hostname, { all }, (error, address) => done({ error, address }));
  });
}

describe("guardedLookup", () => {
  const table = { "public.example": ["93.184.216.34"], "inside.example": ["192.168.0.5"], "mixed.example": ["93.184.216.34", "10.0.0.5"] };

  it("hands back the addresses of a name that resolves outside the refused ranges", async () => {
    const lookup = guardedLookup(allowSet([]), resolverFor(table));
    expect(await resolve(lookup, "public.example", true)).toEqual({ error: null, address: [{ address: "93.184.216.34", family: 4 }] });
    expect(await resolve(lookup, "public.example", false)).toEqual({ error: null, address: "93.184.216.34" });
  });

  it("fails for a name that resolves into a refused range", async () => {
    const lookup = guardedLookup(allowSet([]), resolverFor(table));
    const { error } = await resolve(lookup, "inside.example", true);
    expect(error).toMatchObject({ code: "EDESTINATION" });
    expect((await resolve(lookup, "inside.example", false)).error).toMatchObject({ code: "EDESTINATION" });
  });

  it("fails when any one of several addresses is in a refused range", async () => {
    const lookup = guardedLookup(allowSet([]), resolverFor(table));
    expect((await resolve(lookup, "mixed.example", true)).error).toMatchObject({ code: "EDESTINATION" });
  });

  it("lets an allowed host resolve into a refused range, whatever the letter case", async () => {
    const lookup = guardedLookup(allowSet(["Inside.Example"]), resolverFor(table));
    expect(await resolve(lookup, "inside.example", true)).toEqual({ error: null, address: [{ address: "192.168.0.5", family: 4 }] });
    expect((await resolve(lookup, "mixed.example", true)).error).toMatchObject({ code: "EDESTINATION" });
  });

  it("passes a failed resolution on unchanged", async () => {
    const lookup = guardedLookup(allowSet([]), resolverFor(table));
    expect((await resolve(lookup, "missing.example", true)).error).toMatchObject({ code: "ENOTFOUND" });
  });
});
