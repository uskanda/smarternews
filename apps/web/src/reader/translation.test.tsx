import { insertFeed, saveArticleTranslation, saveTranslatedTitle, type TranslationItem } from "@smarternews/core";
import { seedFeedArticle } from "@smarternews/core/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeServer, renderApp } from "../testing/harness.tsx";

const list = () => screen.getByRole("region", { name: "記事の一覧" });
const opened = () => screen.findByRole("article", { name: "記事" });
const rowTitles = () => within(list()).queryAllByRole("listitem").map((item) => item.querySelector("[data-title]")?.textContent);
const BODY = "First paragraph.\n\n```\ncode();\n```\n\nSecond paragraph.";
const AT = "2026-03-01T11:00:00.000Z";
const WAITING = "翻訳しています。";
const FAILED = "翻訳できませんでした。原文を表示しています。";
const REST = "長い記事のため、ここから先は翻訳していません。";

/** A translation API that answers when the test lets it. */
function gated(answer: (item: TranslationItem) => string = (item) => `訳:${item.text}`) {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const calls: Array<{ items: TranslationItem[]; target: string }> = [];
  return {
    open,
    google: {
      calls,
      async translate(items: TranslationItem[], target: string) {
        calls.push({ items, target });
        await gate;
        return { texts: items.map(answer), sourceLanguage: "en" };
      },
    },
  };
}

function seeded(options: Parameters<typeof makeServer>[1] = {}, translate = true) {
  const server = makeServer(undefined, options);
  const feed = insertFeed(server.db, { url: "https://blog.example.org/feed.xml", title: "Blog", translate }, server.clock);
  const id = seedFeedArticle(server.db, feed.id, { title: "Original title", body: BODY, at: AT });
  const route = `/f/${feed.id}/${id}`;
  const posts = (requests: string[]) => requests.filter((request) => request === `POST /api/v1/articles/${id}/translation`);
  return { server, feed, id, route, posts };
}

/** The texts of the translated body, each marked as a translation, an original under one, or a segment shown alone. */
function segments(pane: HTMLElement): string[] {
  return [...pane.querySelectorAll(".article-body > *")].flatMap((node) => {
    if (!node.classList.contains("segment")) return [`${node.getAttribute("role") === "note" ? "note" : "alone"}: ${node.textContent}`];
    return [...node.children].map((part) => `${part.classList.contains("segment-original") ? "original" : "translation"}: ${part.textContent}`);
  });
}

describe("the title of a translated feed article", () => {
  it("is the translation in the list for an article that has one, and the original for one that has none", async () => {
    const { server, feed, id } = seeded();
    seedFeedArticle(server.db, feed.id, { title: "No translation yet", at: "2026-03-01T10:00:00.000Z" });
    saveTranslatedTitle(server.db, id, { original: "Original title", title: "訳したタイトル", sourceLanguage: "en" });
    renderApp({ server, route: `/f/${feed.id}` });
    await waitFor(() => expect(rowTitles()).toEqual(["訳したタイトル", "No translation yet"]));
  });

  it("is the headline of the article and the title of the tab, with the original right under the headline in its own language", async () => {
    const { server, id, route } = seeded();
    saveTranslatedTitle(server.db, id, { original: "Original title", title: "訳したタイトル", sourceLanguage: "en" });
    saveArticleTranslation(server.db, id, { segments: [{ original: BODY, translated: null }], method: "google", truncated: false, now: AT });
    renderApp({ server, route });
    const pane = await opened();

    const headline = within(pane).getByRole("heading", { level: 2 });
    expect(headline).toHaveTextContent("訳したタイトル");
    const original = headline.nextElementSibling!;
    expect(original).toHaveTextContent("Original title");
    expect(original).toHaveAttribute("lang", "en");
    expect(original).toHaveClass("type-body-md", "text-on-surface-muted");
    await waitFor(() => expect(document.title).toContain("訳したタイトル"));
  });
});

describe("opening an article of a feed that translates", () => {
  it("asks for the translation, shows the original while it waits, then each translation with its original under it", async () => {
    const api = gated();
    const { server, route, posts } = seeded({ google: api.google });
    const { requests } = renderApp({ server, route });
    const pane = await opened();

    expect(await within(pane).findByRole("status")).toHaveTextContent(WAITING);
    expect(within(pane).getByRole("heading", { level: 2 })).toHaveTextContent("Original title");
    expect(within(pane).getByText("First paragraph.")).toBeInTheDocument();
    expect(pane.querySelector(".segment")).toBeNull();
    expect(posts(requests)).toHaveLength(1);

    api.open();

    await within(pane).findByText("訳:First paragraph.");
    expect(segments(pane)).toEqual([
      "translation: 訳:First paragraph.",
      "original: First paragraph.",
      "alone: code();\n",
      "translation: 訳:Second paragraph.",
      "original: Second paragraph.",
    ]);
    expect(pane).not.toHaveTextContent(WAITING);
    expect(within(pane).getByRole("heading", { level: 2 })).toHaveTextContent("訳:Original title");
    for (const original of pane.querySelectorAll(".segment-original")) expect(original).toHaveAttribute("lang", "en");
    expect(pane.querySelector(".segment > :not(.segment-original)")).not.toHaveAttribute("lang");
    expect(pane.querySelectorAll("pre")).toHaveLength(1);
    expect(pane.querySelector("pre")!.closest(".segment-original")).toBeNull();
    await waitFor(() => expect(within(list()).getByRole("link", { name: /訳:Original title/ })).toBeInTheDocument());
  });

  it("shows the stored translation at once and asks for nothing when the article has one", async () => {
    const { server, id, route, posts } = seeded();
    saveTranslatedTitle(server.db, id, { original: "Original title", title: "訳したタイトル", sourceLanguage: "en" });
    saveArticleTranslation(server.db, id, { segments: [{ original: "Stored original.", translated: "保存した訳。" }], method: "google", truncated: false, now: AT });
    const { requests } = renderApp({ server, route });
    const pane = await opened();
    await within(pane).findByText("保存した訳。");
    expect(segments(pane)).toEqual(["translation: 保存した訳。", "original: Stored original."]);
    expect(posts(requests)).toEqual([]);
  });

  it("asks for nothing and shows the content as before for an article of a feed that does not translate", async () => {
    const { server, route, posts } = seeded({}, false);
    const { requests } = renderApp({ server, route });
    const pane = await opened();
    await within(pane).findByText("First paragraph.");
    expect(pane.querySelector(".segment")).toBeNull();
    expect(within(pane).queryByRole("status")).toBeNull();
    expect(posts(requests)).toEqual([]);
    expect(server.google!.calls).toEqual([]);
  });

  it("keeps the original and offers to try again when the article cannot be translated now", async () => {
    const { server, route, posts } = seeded({ google: null, llmCallsPerDay: 0 });
    const { requests, user } = renderApp({ server, route });
    const pane = await opened();

    expect(await within(pane).findByText(FAILED)).toBeInTheDocument();
    expect(within(pane).getByText("First paragraph.")).toBeInTheDocument();
    expect(within(pane).getByRole("heading", { level: 2 })).toHaveTextContent("Original title");
    expect(posts(requests)).toHaveLength(1);

    await user.click(within(pane).getByRole("button", { name: "翻訳をやり直す" }));
    await waitFor(() => expect(posts(requests)).toHaveLength(2));
    expect(await within(pane).findByText(FAILED)).toBeInTheDocument();
  });
});

describe("the segments of a translated article", () => {
  function stored(parts: Array<{ original: string; translated: string | null }>, truncated = false) {
    const s = seeded();
    saveTranslatedTitle(s.server.db, s.id, { original: "Original title", title: "訳したタイトル", sourceLanguage: "en" });
    saveArticleTranslation(s.server.db, s.id, { segments: parts, method: "google", truncated, now: AT });
    return s;
  }

  it("show the original smaller and quieter than the translation", async () => {
    const { server, route } = stored([{ original: "An original.", translated: "訳。" }]);
    renderApp({ server, route });
    const pane = await opened();
    await within(pane).findByText("訳。");
    expect(pane.querySelector(".article-body")).toHaveClass("type-body-lg");
    expect(pane.querySelector(".segment-original")).toHaveTextContent("An original.");
  });

  it("keep the original of a heading out of the outline: only the translation is a heading", async () => {
    const { server, route } = stored([{ original: "## A section", translated: "## ある節" }]);
    renderApp({ server, route });
    const pane = await opened();
    await within(pane).findByText("ある節");
    expect(within(pane).getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["訳したタイトル", "ある節"]);
    expect(pane.querySelector(".segment-original")).toHaveTextContent("A section");
  });

  it("show a segment once when its translation is the same text as its original", async () => {
    const { server, route } = stored([
      { original: "Same in both.", translated: "Same in both." },
      { original: "Differs.", translated: "違う。" },
    ]);
    renderApp({ server, route });
    const pane = await opened();
    await within(pane).findByText("違う。");
    expect(segments(pane)).toEqual(["alone: Same in both.", "translation: 違う。", "original: Differs."]);
  });

  it("say after the last translated segment that the rest is the original only", async () => {
    const { server, route } = stored(
      [
        { original: "Translated part.", translated: "訳した部分。" },
        { original: "The rest, one.", translated: null },
        { original: "The rest, two.", translated: null },
      ],
      true,
    );
    renderApp({ server, route });
    const pane = await opened();
    await within(pane).findByText("訳した部分。");
    expect(segments(pane)).toEqual(["translation: 訳した部分。", "original: Translated part.", `note: ${REST}`, "alone: The rest, one.", "alone: The rest, two."]);
  });

  it("show a tag in a translation as the characters it is, and open its links like those of the original", async () => {
    const { server, route } = stored([
      { original: "Before [the notes](https://example.org/notes) after.", translated: "前 <script>window.translated = true</script> [注記](https://example.org/notes) 後。" },
    ]);
    renderApp({ server, route });
    const pane = await opened();
    const link = await within(pane).findByRole("link", { name: "注記" });

    expect(link).toHaveAttribute("href", "https://example.org/notes");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(pane.querySelector(".segment")).toHaveTextContent("<script>window.translated = true</script>");
    expect(pane.querySelector("script")).toBeNull();
    expect((window as unknown as { translated?: boolean }).translated).toBeUndefined();
  });
});
