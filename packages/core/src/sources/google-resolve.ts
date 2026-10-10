import type { Fetcher } from "../fetch/http.ts";

const ARTICLE = /^https:\/\/news\.google\.com\/(?:rss\/)?articles\/([A-Za-z0-9_-]+)/;
const BATCH_URL = "https://news.google.com/_/DotsSplashUi/data/batchexecute";

/**
 * Turns a Google News redirect link into the URL of the original page, or null when that is not possible.
 * Google publishes no API for this: the article page carries a signature, and a second request trades it for
 * the URL. Either step can stop working without notice, so every failure is an ordinary null.
 */
export async function resolveGoogleNewsUrl(fetcher: Fetcher, link: string): Promise<string | null> {
  const id = ARTICLE.exec(link)?.[1];
  if (!id) return null;
  try {
    const page = await fetcher.get(`https://news.google.com/rss/articles/${id}`);
    if (page.status !== 200) return null;
    const signature = /data-n-a-sg="([^"]+)"/.exec(page.text)?.[1];
    const timestamp = /data-n-a-ts="(\d+)"/.exec(page.text)?.[1];
    if (!signature || !timestamp) return null;

    const request = [
      "garturlreq",
      [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
      id,
      Number(timestamp),
      signature,
    ];
    const answer = await fetcher.get(BATCH_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: `f.req=${encodeURIComponent(JSON.stringify([[["Fbv4je", JSON.stringify(request), null, "generic"]]]))}`,
    });
    if (answer.status !== 200) return null;

    const rows = JSON.parse(answer.text.replace(/^\)\]\}'/, "")) as unknown[][];
    const payload = rows.find((row) => row[0] === "wrb.fr" && row[1] === "Fbv4je")?.[2];
    if (typeof payload !== "string") return null;
    const [tag, url] = JSON.parse(payload) as [string, unknown];
    return tag === "garturlres" && typeof url === "string" && /^https?:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}
