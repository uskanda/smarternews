// The link that the web app shows as a QR code and the Android app reads: it carries the server's URL and the
// API token. Parsed by hand, because not every JavaScript runtime the app runs on has a complete URL class.

const PREFIX = "smarternews://connect?";

export interface Connection {
  url: string;
  token: string;
}

export function buildConnectLink(url: string, token: string): string {
  return `${PREFIX}v=1&url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`;
}

/** What a scanned or pasted text connects to, or null when it is not a connection link of this version. */
export function parseConnectLink(text: string): Connection | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(PREFIX)) return null;
  const fields = new Map<string, string>();
  try {
    for (const pair of trimmed.slice(PREFIX.length).split("&")) {
      const at = pair.indexOf("=");
      if (at > 0) fields.set(pair.slice(0, at), decodeURIComponent(pair.slice(at + 1)));
    }
  } catch {
    return null;
  }
  const url = normalizeServerUrl(fields.get("url") ?? "");
  const token = fields.get("token") ?? "";
  if (fields.get("v") !== "1" || url === null || token.length === 0 || !/^https?:\/\//i.test(fields.get("url") ?? "")) return null;
  return { url, token };
}

/** The server's address as the API client takes it: scheme, host and port. Null when the input is not one. */
export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const match = /^(https?):\/\/([^/?#\s]+)/i.exec(withScheme);
  if (!match) return null;
  return `${match[1]!.toLowerCase()}://${match[2]!}`;
}
