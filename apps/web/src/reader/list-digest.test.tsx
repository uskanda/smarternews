import { listDigests, replaceMentions, setArticleFlags } from "@smarternews/core";
import type { FakeHandler } from "@smarternews/core/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";

const MINUTE = 60_000;
const list = () => screen.getByRole("region", { name: "記事の一覧" });
const summarize = () => within(list()).queryByRole("button", { name: "この一覧をまとめる" });
const answer: FakeHandler = () => ({ executiveSummary: "What the list says.", sections: [] });

/** Category Alpha with a starred article on batteries, a read one, an unrelated one, and a name on the first. */
function seeded(handler: FakeHandler = answer): { server: TestServer; slug: string } {
  const server = makeServer("2026-03-01T06:00:00.000Z", { digest: handler });
  const alpha = server.category("Alpha");
  const starred = server.article(alpha.id, { title: "電池の話" });
  setArticleFlags(server.db, starred, { starred: true }, server.clock().toISOString());
  replaceMentions(server.db, starred, [{ name: "日本銀行", kind: "organization" }]);
  server.clock.advance(MINUTE);
  const read = server.article(alpha.id, { title: "電池の既読の話" });
  setArticleFlags(server.db, read, { isRead: true }, server.clock().toISOString());
  server.article(alpha.id, { title: "関係のない話" });
  return { server, slug: alpha.slug };
}

/** The target of the digest the server made, once it is made. */
async function madeTarget(server: TestServer) {
  await server.digests.idle();
  return listDigests(server.db)[0]?.target;
}

describe("summing up a list", () => {
  it("makes a digest of the starred articles, says it started, and opens the digests from the message", async () => {
    const { server } = seeded();
    const { user, path, requests } = renderApp({ server, route: "/starred" });
    await within(list()).findByText("電池の話");

    await user.click(summarize()!);

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("ダイジェストを作り始めました。");
    expect(requests.filter((request) => request === "POST /api/v1/digests")).toHaveLength(1);
    expect(await madeTarget(server)).toEqual({ type: "starred", label: "スター" });
    await user.click(within(status).getByRole("button", { name: "ダイジェストを開く" }));
    expect(path()).toBe("/digests");
  });

  it("sends the words and the narrowing of a search", async () => {
    const { server, slug } = seeded();
    const { user } = renderApp({ server, route: `/search?q=${encodeURIComponent("電池")}&category=${slug}&unread=true` });
    // The words are marked in the titles, so the rows are waited for rather than a title.
    await waitFor(() => expect(within(list()).queryAllByRole("listitem")).toHaveLength(1));

    await user.click(summarize()!);

    await screen.findByText(/ダイジェストを作り始めました/);
    expect(await madeTarget(server)).toEqual({ type: "search", label: "検索：電池（カテゴリ：Alpha、未読だけ）" });
  });

  it("sends the name of the articles of a name", async () => {
    const { server } = seeded();
    const { user } = renderApp({ server, route: `/mentions?${new URLSearchParams({ name: "日本銀行" })}` });
    await within(list()).findByText("電池の話");

    await user.click(summarize()!);

    await screen.findByText(/ダイジェストを作り始めました/);
    expect(await madeTarget(server)).toEqual({ type: "mention", label: "名前：日本銀行" });
  });

  it("is offered on those three lists only, and not before a search has words", async () => {
    const { server } = seeded();
    const first = renderApp({ server, route: "/unread" });
    await within(list()).findByText("電池の話");
    expect(summarize()).not.toBeInTheDocument();
    first.unmount();

    renderApp({ server, route: "/search" });
    await screen.findByText(/検索欄に語を入れて/);
    expect(summarize()).not.toBeInTheDocument();
  });

  it("says that an empty list makes no digest", async () => {
    const empty = makeServer("2026-03-01T06:00:00.000Z", { digest: answer });
    empty.article(empty.category().id, { title: "Not starred" });
    const { user } = renderApp({ server: empty, route: "/starred" });
    await screen.findByText("スターを付けた記事はありません。");
    await user.click(summarize()!);
    expect(await screen.findByText("この一覧には記事がないため、作りませんでした。")).toBeInTheDocument();
  });

  it("says that the day reached its limit", async () => {
    const limited = makeServer("2026-03-01T06:00:00.000Z", { digest: answer, digestsPerDay: 0 });
    const article = limited.article(limited.category().id, { title: "Starred" });
    setArticleFlags(limited.db, article, { starred: true }, limited.clock().toISOString());
    const { user } = renderApp({ server: limited, route: "/starred" });
    await within(list()).findByText("Starred");
    await user.click(summarize()!);
    expect(await screen.findByText(/1日の上限/)).toBeInTheDocument();
  });

  it("says that a digest is already being made", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { server } = seeded(async (request) => {
      await gate;
      return answer(request);
    });
    expect(server.digests.buildNow()).toBe("queued");
    const { user } = renderApp({ server, route: "/starred" });
    await within(list()).findByText("電池の話");
    await user.click(summarize()!);
    expect(await screen.findByText(/すでに作っています/)).toBeInTheDocument();
    release();
    await waitFor(() => expect(server.digests.building).toBe(false));
  });
});
