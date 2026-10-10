// Scans tracked files for strings that should not land in a public repository: email addresses,
// carrier-grade NAT addresses (the range Tailscale assigns), named home directories, and the terms in a
// deny list kept outside the repository. Run by `make verify`.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type FindingKind = "email" | "cgnat-ip" | "home-path" | "deny-term";

export interface Finding {
  kind: FindingKind;
  match: string;
  line: number;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ALLOWED_EMAIL_HOSTS = /(^|\.)(example\.(com|org|net)|users\.noreply\.github\.com)$/i;
const ALLOWED_EMAILS = new Set(["noreply@anthropic.com"]);
const IPV4 = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])(\/\d{1,2})?/g;
const HOME_PATH = /\/(?:home|Users)\/([A-Za-z0-9._-]+)\//g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findInLine(line: string, denyTerms: string[]): Omit<Finding, "line">[] {
  const found: Omit<Finding, "line">[] = [];
  for (const match of line.matchAll(EMAIL)) {
    const host = match[0].slice(match[0].lastIndexOf("@") + 1);
    if (ALLOWED_EMAIL_HOSTS.test(host) || ALLOWED_EMAILS.has(match[0].toLowerCase())) continue;
    found.push({ kind: "email", match: match[0] });
  }
  for (const match of line.matchAll(IPV4)) {
    const [first, second] = [Number(match[1]), Number(match[2])];
    const isCidrBlock = match[5] !== undefined;
    if (first === 100 && second >= 64 && second <= 127 && !isCidrBlock) {
      found.push({ kind: "cgnat-ip", match: match[0] });
    }
  }
  for (const match of line.matchAll(HOME_PATH)) {
    found.push({ kind: "home-path", match: match[0] });
  }
  for (const term of denyTerms) {
    for (const match of line.matchAll(new RegExp(escapeRegExp(term), "gi"))) {
      found.push({ kind: "deny-term", match: match[0] });
    }
  }
  return found;
}

export function findPrivateStrings(text: string, options: { denyTerms: string[] }): Finding[] {
  const denyTerms = options.denyTerms.filter((term) => term.length > 0);
  return text
    .split("\n")
    .flatMap((line, index) => findInLine(line, denyTerms).map((finding) => ({ ...finding, line: index + 1 })));
}

function loadDenyTerms(): string[] {
  const path =
    process.env.SMARTERNEWS_PRIVATE_TERMS ??
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "smarternews", "private-terms.txt");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function main(): void {
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
  })
    .split("\0")
    .filter((file) => file.length > 0 && file !== "pnpm-lock.yaml" && existsSync(file));
  const denyTerms = loadDenyTerms();
  let count = 0;
  for (const file of files) {
    const buffer = readFileSync(file);
    if (buffer.includes(0)) continue;
    for (const finding of findPrivateStrings(buffer.toString("utf8"), { denyTerms })) {
      count += 1;
      console.error(`${file}:${finding.line}: ${finding.kind}: ${finding.match}`);
    }
  }
  if (count > 0) {
    console.error(`check-private: ${count} finding(s). Remove them, or use a placeholder.`);
    process.exit(1);
  }
  console.log(`[private] ${files.length} files clean (${denyTerms.length} deny terms)`);
}

if (import.meta.main) main();
