import { IMAGE_PROXY_PATH } from "@smarternews/core";
import { seedFeed, seedFeedArticle } from "@smarternews/core/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeServer, renderApp } from "../testing/harness.tsx";

const article = () => screen.getByRole("article", { name: "記事" });
const attachments = () => within(article()).queryByRole("region", { name: "添付" });

const PAGE = "https://video.example.org/watch/1";

/** A feed article with the given attachments, stored as ingestion stores them. */
function seeded(stored: unknown[] | null) {
  const server = makeServer();
  const feed = seedFeed(server.db, { title: "Video Feed" });
  const id = seedFeedArticle(server.db, feed, { title: "動画の記事", body: "動画の説明。", url: PAGE });
  server.db.prepare("UPDATE articles SET attachments = ? WHERE id = ?").run(stored === null ? null : JSON.stringify(stored), id);
  return { server, route: `/f/${feed}/${id}` };
}

async function openArticle() {
  await waitFor(() => expect(within(article()).getByRole("heading", { name: "動画の記事" })).toBeInTheDocument());
}

describe("the attachments below the body", () => {
  it("show an image through the relay, the thumbnail as a link to the article's page, and the other files as links with kind and size", async () => {
    const { server, route } = seeded([
      { url: "https://img.example.org/cover.jpg", kind: "image", mimeType: "image/jpeg", size: null, title: "表紙", thumbnail: false },
      { url: "https://img.example.org/thumb.jpg", kind: "image", mimeType: null, size: null, title: "動画の題", thumbnail: true },
      { url: "https://cdn.example.org/episode.mp3", kind: "audio", mimeType: "audio/mpeg", size: 12_345_678, title: null, thumbnail: false },
    ]);
    renderApp({ server, route });
    await openArticle();

    const region = await waitFor(() => attachments()!);
    expect(within(region).getByRole("heading", { name: "添付" })).toBeInTheDocument();
    const cover = within(region).getByRole("img", { name: "表紙" });
    expect(cover.getAttribute("src")!.startsWith(IMAGE_PROXY_PATH)).toBe(true);
    expect(cover).toHaveAttribute("loading", "lazy");
    expect(cover.closest("a")).toBeNull();

    const thumbnail = within(region).getByRole("link", { name: "元のページを開く：動画の題" });
    expect(thumbnail).toHaveAttribute("href", PAGE);
    expect(thumbnail).toHaveAttribute("target", "_blank");
    expect(within(thumbnail).getByRole("img").getAttribute("src")!.startsWith(IMAGE_PROXY_PATH)).toBe(true);

    const audio = within(region).getByRole("link", { name: "episode.mp3" });
    expect(audio).toHaveAttribute("href", "https://cdn.example.org/episode.mp3");
    expect(audio).toHaveAttribute("target", "_blank");
    expect(audio).toHaveAttribute("rel", "noopener noreferrer");
    expect(audio.parentElement).toHaveTextContent("episode.mp3音声、11.8 MB");

    // No original address of an image is loaded, and nothing is played or embedded.
    for (const image of region.querySelectorAll("img")) expect(image.getAttribute("src")!.startsWith(IMAGE_PROXY_PATH)).toBe(true);
    expect(region.querySelector("audio, video, iframe, embed, object")).toBeNull();
    // Below the body.
    const body = article().querySelector(".article-body")!;
    expect(body.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(body).not.toHaveTextContent("episode.mp3");
  });

  it("are not there for an article without attachments", async () => {
    const { server, route } = seeded(null);
    renderApp({ server, route });
    await openArticle();
    expect(attachments()).toBeNull();
  });
});
