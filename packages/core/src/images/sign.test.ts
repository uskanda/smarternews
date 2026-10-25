import { describe, expect, it } from "vitest";
import { IMAGE_PROXY_PATH, isImageProxyPath } from "../api.ts";
import { imageProxyPath, verifyImageProxyPath } from "./sign.ts";

const key = new Uint8Array(32).fill(7);
const otherKey = new Uint8Array(32).fill(8);
const parts = (path: string) => {
  const [signature, encoded] = path.slice(IMAGE_PROXY_PATH.length).split("/");
  return { signature: signature!, encoded: encoded! };
};

describe("the URL of a relayed image", () => {
  it("is a path of this server that carries a signature and the original URL", () => {
    const path = imageProxyPath(key, "http://img.example.org/a.png?x=1&y=日本");
    expect(path.startsWith(IMAGE_PROXY_PATH)).toBe(true);
    expect(isImageProxyPath(path)).toBe(true);
    expect(path).toMatch(/^\/api\/v1\/image-proxy\/[A-Za-z0-9_-]{43}\/[A-Za-z0-9_-]+$/);
    const { signature, encoded } = parts(path);
    expect(verifyImageProxyPath(key, signature, encoded)).toBe("http://img.example.org/a.png?x=1&y=日本");
  });

  it("is the same for the same URL and key, whenever it is made", () => {
    expect(imageProxyPath(key, "https://img.example.org/a.png")).toBe(imageProxyPath(key, "https://img.example.org/a.png"));
  });

  it("is refused when the original URL is replaced", () => {
    const { signature } = parts(imageProxyPath(key, "https://img.example.org/a.png"));
    const { encoded } = parts(imageProxyPath(key, "https://img.example.org/b.png"));
    expect(verifyImageProxyPath(key, signature, encoded)).toBeNull();
  });

  it("is refused without a signature", () => {
    const { encoded } = parts(imageProxyPath(key, "https://img.example.org/a.png"));
    expect(verifyImageProxyPath(key, "", encoded)).toBeNull();
  });

  it("is refused when another key signed it", () => {
    const { signature, encoded } = parts(imageProxyPath(otherKey, "https://img.example.org/a.png"));
    expect(verifyImageProxyPath(key, signature, encoded)).toBeNull();
  });

  it("is refused when its parts are not base64url, or the signature is cut short", () => {
    const { signature, encoded } = parts(imageProxyPath(key, "https://img.example.org/a.png"));
    expect(verifyImageProxyPath(key, signature, `${encoded}!`)).toBeNull();
    expect(verifyImageProxyPath(key, `${signature}=`, encoded)).toBeNull();
    expect(verifyImageProxyPath(key, signature.slice(0, 20), encoded)).toBeNull();
    expect(verifyImageProxyPath(key, signature, "")).toBeNull();
  });

  it("is not a relayed image when it is anything else", () => {
    expect(isImageProxyPath("https://img.example.org/a.png")).toBe(false);
    expect(isImageProxyPath("/api/v1/articles")).toBe(false);
    expect(isImageProxyPath("//evil.example/api/v1/image-proxy/a/b")).toBe(false);
  });
});
