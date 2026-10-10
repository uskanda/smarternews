import { describe, expect, it } from "vitest";
import { findPrivateStrings, isKeyFile } from "./check-private.ts";

// The samples are assembled at run time so that this file does not trip the check it tests.
const at = "@";
const cgnat = ["100", "101", "7", "9"].join(".");
const home = ["", "home", "alice", "notes.txt"].join("/");

const kinds = (text: string, denyTerms: string[] = []) =>
  findPrivateStrings(text, { denyTerms }).map((finding) => finding.kind);

describe("findPrivateStrings", () => {
  it("reports an email address", () => {
    expect(kinds(`contact: someone${at}mail.test`)).toEqual(["email"]);
  });

  it("accepts addresses on reserved example domains and noreply hosts", () => {
    const text = [
      `a${at}example.com`,
      `b${at}example.org`,
      `1+c${at}users.noreply.github.com`,
      `noreply${at}anthropic.com`,
    ].join("\n");
    expect(kinds(text)).toEqual([]);
  });

  it("reports an address inside the carrier-grade NAT range", () => {
    expect(kinds(`listen: ${cgnat}:8787`)).toEqual(["cgnat-ip"]);
  });

  it("accepts addresses outside the range and the range written as a CIDR block", () => {
    expect(kinds("100.63.255.255 192.168.0.4 100.128.0.1 100.64.0.0/10")).toEqual([]);
  });

  it("reports a path under a named home directory", () => {
    expect(kinds(`db: ${home}`)).toEqual(["home-path"]);
  });

  it("accepts a home path written with a placeholder", () => {
    expect(kinds("db: /home/<user>/data and ~/.config/smarternews")).toEqual([]);
  });

  it("reports a term from the deny list regardless of letter case", () => {
    const findings = findPrivateStrings("Hosted on MyBox today", { denyTerms: ["mybox"] });
    expect(findings).toEqual([{ kind: "deny-term", match: "MyBox", line: 1 }]);
  });

  it("reports the line number of each finding", () => {
    const findings = findPrivateStrings(`first\nsecond ${cgnat}\n`, { denyTerms: [] });
    expect(findings).toEqual([{ kind: "cgnat-ip", match: cgnat, line: 2 }]);
  });
});

describe("isKeyFile", () => {
  it.each(["release.jks", "apps/mobile/release.keystore", "certs/signing.p12", "a/b/upload.PFX", "id_rsa.key"])("reports %s as a signing key", (path) => {
    expect(isKeyFile(path)).toBe(true);
  });

  it.each(["apps/mobile/plugins/with-release-signing.js", "docs/keystore.md", "src/keys.ts", "notes.keystore.txt"])("accepts %s", (path) => {
    expect(isKeyFile(path)).toBe(false);
  });
});
