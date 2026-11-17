import { getArticle, updateSettings } from "@smarternews/core";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeServer, renderApp } from "../testing/harness.tsx";

const HOUR = 3_600_000;
const list = () => screen.getByRole("region", { name: "記事の一覧" });
const menuButton = () => screen.getByRole("button", { name: "期間を選んで既読にする" });

/**
 * Category A holds an article of 42 hours ago and one of 6 hours ago, and category C one unread article. The list
 * is read a moment after the last one is stored.
 */
function seeded(options: { advance?: boolean; importance?: [number, number] } = {}) {
  const server = makeServer();
  if (options.advance) updateSettings(server.db, { advanceAfterMarkAll: true });
  const a = server.category("A");
  const c = server.category("C");
  const [oldImportance, recentImportance] = options.importance ?? [3, 3];
  const old = server.article(a.id, { title: "Old story", importance: oldImportance });
  server.clock.advance(36 * HOUR);
  const recent = server.article(a.id, { title: "Recent story", importance: recentImportance });
  server.article(c.id, { title: "About C" });
  server.clock.advance(6 * HOUR);
  return { server, a, c, old, recent };
}

async function choose(user: ReturnType<typeof renderApp>["user"], label: string) {
  await within(list()).findByRole("link", { name: /Recent story/ });
  await user.click(menuButton());
  await user.click(screen.getByRole("menuitem", { name: label }));
}

describe("marking the articles older than a period as read", () => {
  it("offers a menu of three periods right of 'mark all as read'", async () => {
    const { server, a } = seeded();
    const { user } = renderApp({ server, route: `/c/${a.slug}` });
    await within(list()).findByRole("link", { name: /Recent story/ });

    const markAll = screen.getByRole("button", { name: "すべて既読にする" });
    const button = menuButton();
    expect(markAll.parentElement).toBe(button.parentElement?.parentElement);
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");

    await user.click(button);

    const menu = screen.getByRole("menu", { name: "期間を選んで既読にする" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["1日より古い記事", "3日より古い記事", "1週間より古い記事"]);
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("marks only the articles older than a day, says how many, and offers the undo", async () => {
    const { server, a, old, recent } = seeded();
    const { user } = renderApp({ server, route: `/c/${a.slug}` });

    await choose(user, "1日より古い記事");

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("1件を既読にしました");
    expect(getArticle(server.db, old).isRead).toBe(true);
    expect(getArticle(server.db, recent).isRead).toBe(false);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(within(status).getByRole("button", { name: "取り消す" }));
    await waitFor(() => expect(getArticle(server.db, old).isRead).toBe(false));
  });

  it("keeps to the category and the importance filter", async () => {
    const { server, a, c, old } = seeded({ importance: [4, 3] });
    const lowOld = server.article(a.id, { title: "Routine old", importance: 3 });
    // Stored now, then the clock moves past a day.
    server.clock.advance(30 * HOUR);
    const { user } = renderApp({ server, route: `/c/${a.slug}?min=4` });
    await within(list()).findByRole("link", { name: /Old story/ });
    await user.click(menuButton());
    await user.click(screen.getByRole("menuitem", { name: "1日より古い記事" }));

    expect(await screen.findByRole("status")).toHaveTextContent("1件を既読にしました");
    expect(getArticle(server.db, old).isRead).toBe(true);
    expect(getArticle(server.db, lowOld).isRead).toBe(false);
    const others = server.db.prepare("SELECT is_read FROM articles WHERE category_id = ?").all(c.id) as Array<{ is_read: number }>;
    expect(others.every((row) => row.is_read === 0)).toBe(true);
  });

  it("leaves unread what arrived after the list was read, though it is older than the period now", async () => {
    const { server, a, old, recent } = seeded();
    const { user } = renderApp({ server, route: `/c/${a.slug}` });
    await within(list()).findByRole("link", { name: /Recent story/ });
    server.clock.advance(18 * HOUR);
    const later = server.article(a.id, { title: "Arrived later" });
    server.clock.advance(54 * HOUR);

    await choose(user, "1日より古い記事");

    expect(await screen.findByRole("status")).toHaveTextContent("2件を既読にしました");
    expect(getArticle(server.db, old).isRead).toBe(true);
    expect(getArticle(server.db, recent).isRead).toBe(true);
    expect(getArticle(server.db, later).isRead).toBe(false);
  });

  it("stays on the list, though the setting moves on after marking all", async () => {
    const { server, a } = seeded({ advance: true });
    const { user, path } = renderApp({ server, route: `/c/${a.slug}` });

    await choose(user, "1日より古い記事");

    expect(await screen.findByRole("status")).toHaveTextContent("1件を既読にしました");
    expect(path()).toBe(`/c/${a.slug}`);
    expect(within(list()).getByRole("link", { name: /Recent story/ })).toBeInTheDocument();
  });

  it("says that nothing is older than the period, and offers no undo", async () => {
    const { server, a, old } = seeded();
    const { user } = renderApp({ server, route: `/c/${a.slug}` });

    await choose(user, "3日より古い記事");

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("3日より古い未読はありません");
    expect(within(status).queryByRole("button", { name: "取り消す" })).not.toBeInTheDocument();
    expect(getArticle(server.db, old).isRead).toBe(false);
  });

  it("opens with the down arrow, moves with the arrows, and gives the focus back on Escape", async () => {
    const { server, a } = seeded();
    const { user } = renderApp({ server, route: `/c/${a.slug}` });
    await within(list()).findByRole("link", { name: /Recent story/ });

    menuButton().focus();
    await user.keyboard("{ArrowDown}");
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items[0]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(items[2]).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(menuButton()).toHaveFocus();
  });

  it("keeps the keys in the menu from the reader's shortcuts", async () => {
    const { server, a, old, recent } = seeded();
    const { user } = renderApp({ server, route: `/c/${a.slug}` });
    await within(list()).findByRole("link", { name: /Recent story/ });

    menuButton().focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Shift>}A{/Shift}");

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(getArticle(server.db, old).isRead).toBe(false);
    expect(getArticle(server.db, recent).isRead).toBe(false);
  });

  it("is not offered where marking all as read is not", async () => {
    const { server } = seeded();
    renderApp({ server, route: "/recently-read" });
    await screen.findByRole("heading", { level: 1, name: "最近読んだ記事" });

    expect(screen.queryByRole("button", { name: "すべて既読にする" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "期間を選んで既読にする" })).not.toBeInTheDocument();
  });

  it("holds both buttons and Shift+A while the marking waits for its answer, and sends it once", async () => {
    const { server, a, old, recent } = seeded();
    const { user, requests, hold } = renderApp({ server, route: `/c/${a.slug}` });
    const held = hold("POST /api/v1/articles/mark-read");

    await choose(user, "1日より古い記事");
    (document.activeElement as HTMLElement).blur();
    await user.keyboard("{Shift>}A{/Shift}");

    expect(menuButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "すべて既読にする" })).toBeDisabled();
    expect(requests.filter((request) => request === "POST /api/v1/articles/mark-read")).toHaveLength(1);
    await held.release();
    expect(await screen.findByRole("status")).toHaveTextContent("1件を既読にしました");
    expect(getArticle(server.db, old).isRead).toBe(true);
    expect(getArticle(server.db, recent).isRead).toBe(false);
    expect(menuButton()).toBeEnabled();
  });
});
