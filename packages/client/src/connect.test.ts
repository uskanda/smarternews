import { describe, expect, it } from "vitest";
import { buildConnectLink, normalizeServerUrl, parseConnectLink } from "./connect.ts";

describe("the connection link in the QR code", () => {
  it("carries the server URL and the token, and reads back to the same two", () => {
    const link = buildConnectLink("http://news.example:8790", "tok_en-123");
    expect(link).toBe("smarternews://connect?v=1&url=http%3A%2F%2Fnews.example%3A8790&token=tok_en-123");
    expect(parseConnectLink(link)).toEqual({ url: "http://news.example:8790", token: "tok_en-123" });
  });

  it("keeps a token with characters that mean something in a URL", () => {
    const link = buildConnectLink("https://news.example", "a+b/c=d&e");
    expect(parseConnectLink(link)).toEqual({ url: "https://news.example", token: "a+b/c=d&e" });
  });

  it.each([
    ["an ordinary web address", "https://example.org/"],
    ["another app's link", "otherapp://connect?v=1&url=http%3A%2F%2Fa&token=t"],
    ["a later version of the link", "smarternews://connect?v=2&url=http%3A%2F%2Fa&token=t"],
    ["a link without a token", "smarternews://connect?v=1&url=http%3A%2F%2Fa"],
    ["a link with an empty token", "smarternews://connect?v=1&url=http%3A%2F%2Fa&token="],
    ["a link to something that is not a web server", "smarternews://connect?v=1&url=file%3A%2F%2F%2Fetc&token=t"],
    ["a link whose encoding is broken", "smarternews://connect?v=1&url=%E0%A4%A&token=t"],
    ["plain text", "hello"],
  ])("does not take %s for a connection link", (_what, text) => {
    expect(parseConnectLink(text)).toBeNull();
  });
});

describe("normalizeServerUrl", () => {
  it("keeps an http or https URL and drops what follows the host", () => {
    expect(normalizeServerUrl("http://news.example:8790")).toBe("http://news.example:8790");
    expect(normalizeServerUrl(" https://news.example/ ")).toBe("https://news.example");
    expect(normalizeServerUrl("http://news.example:8790/unread?read=1")).toBe("http://news.example:8790");
  });

  it("assumes http when the scheme is left out, as people type an address and a port", () => {
    expect(normalizeServerUrl("news.example:8790")).toBe("http://news.example:8790");
    expect(normalizeServerUrl("192.0.2.10:8790")).toBe("http://192.0.2.10:8790");
  });

  it("refuses other schemes and empty input", () => {
    expect(normalizeServerUrl("ftp://news.example")).toBeNull();
    expect(normalizeServerUrl("   ")).toBeNull();
    expect(normalizeServerUrl("http://")).toBeNull();
  });
});
