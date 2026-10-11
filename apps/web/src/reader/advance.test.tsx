import { insertFeed, updateSettings } from "@smarternews/core";
import { seedFeedArticle } from "@smarternews/core/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";

const nav = () => screen.getByRole("navigation", { name: "項目" });
const heading = () => within(screen.getByRole("region", { name: "記事の一覧" })).getByRole("heading", { level: 1 }).textContent;

function feedOf(server: TestServer, title: string, categoryId: number | null) {
  return insertFeed(server.db, { url: `https://${title.toLowerCase()}.example.org/feed.xml`, title, categoryId }, server.clock);
}

/**
 * A holds a generated article and the feeds X and Y; B has nothing unread; C has a generated article and the
 * feed P. X, Y and P hold one unread article each.
 */
function seeded(advance = true) {
  const server = makeServer();
  updateSettings(server.db, { advanceAfterMarkAll: advance });
  const a = server.category("A");
  const b = server.category("B");
  const c = server.category("C");
  server.article(a.id, { title: "About A" });
  server.article(c.id, { title: "About C" });
  const x = feedOf(server, "X", a.id);
  const y = feedOf(server, "Y", a.id);
  const p = feedOf(server, "P", c.id);
  seedFeedArticle(server.db, x.id, { title: "From X" });
  seedFeedArticle(server.db, y.id, { title: "From Y" });
  seedFeedArticle(server.db, p.id, { title: "From P" });
  return { server, a, b, c, x, y, p };
}

async function markAll(user: ReturnType<typeof renderApp>["user"], title: string) {
  await waitFor(() => expect(heading()).toBe(title));
  await user.click(await screen.findByRole("button", { name: "すべて既読にする" }));
}

describe("moving on after marking all as read", () => {
  it("opens the next category below that has unread articles", async () => {
    const { server, a, c } = seeded();
    const { user, path } = renderApp({ server, route: `/c/${a.slug}` });
    await markAll(user, "A");
    await waitFor(() => expect(path()).toBe(`/c/${c.slug}`));
    expect(await screen.findByRole("link", { name: /About C/ })).toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent("3件を既読にしました。「C」を開きました");
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("opens the next feed below, then the generated articles of the next category, unfolding it", async () => {
    const { server, x, y, c } = seeded();
    const { user, path } = renderApp({ server, route: `/f/${x.id}` });
    await markAll(user, "X");
    await waitFor(() => expect(path()).toBe(`/f/${y.id}`));
    // The entry it goes to next is below a folded category.
    await user.click(within(nav()).getByRole("button", { name: "Cの下の項目" }));
    await markAll(user, "Y");
    await waitFor(() => expect(path()).toBe(`/c/${c.slug}/generated`));
    expect(within(nav()).getByRole("button", { name: "Cの下の項目" })).toHaveAttribute("aria-expanded", "true");
  });

  it("stays when nothing below is unread", async () => {
    const { server, c } = seeded();
    const { user, path } = renderApp({ server, route: `/c/${c.slug}` });
    await markAll(user, "C");
    expect(await screen.findByRole("status")).toHaveTextContent("2件を既読にしました");
    expect(path()).toBe(`/c/${c.slug}`);
  });

  it("still says what it marked, and offers the undo, when it cannot find out where to go", async () => {
    const { server, a } = seeded();
    let offline = false;
    const view = renderApp({ server, route: `/c/${a.slug}`, offline: () => offline });
    await waitFor(() => expect(heading()).toBe("A"));
    const button = await screen.findByRole("button", { name: "すべて既読にする" });
    // The marking goes through; the counts that decide where to go do not.
    const original = server.app.request.bind(server.app);
    server.app.request = ((input: string, init?: RequestInit) => (String(input).includes("/counts") ? Promise.reject(new TypeError("fetch failed")) : original(input, init))) as typeof server.app.request;
    await view.user.click(button);

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("3件を既読にしました");
    expect(within(status).getByRole("button", { name: "取り消す" })).toBeInTheDocument();
    expect(view.path()).toBe(`/c/${a.slug}`);
    server.app.request = original;
    offline = false;
  });

  it("stays on the views at the top", async () => {
    const { server } = seeded();
    const { user, path } = renderApp({ server, route: "/unread" });
    await markAll(user, "未読");
    expect(await screen.findByRole("status")).toHaveTextContent("5件を既読にしました");
    expect(path()).toBe("/unread");
  });

  it("stays when the setting is off", async () => {
    const { server, a } = seeded(false);
    const { user, path } = renderApp({ server, route: `/c/${a.slug}` });
    await markAll(user, "A");
    expect(await screen.findByRole("status")).toHaveTextContent("3件を既読にしました");
    expect(path()).toBe(`/c/${a.slug}`);
  });

  it("can still be undone after it moved on", async () => {
    const { server, x, y } = seeded();
    const { user, path } = renderApp({ server, route: `/f/${x.id}` });
    await markAll(user, "X");
    await waitFor(() => expect(path()).toBe(`/f/${y.id}`));

    await user.click(within(await screen.findByRole("status")).getByRole("button", { name: "取り消す" }));
    await waitFor(() => expect(within(nav()).getByRole("link", { name: /^X/ })).toHaveTextContent("X1"));
    expect(path()).toBe(`/f/${y.id}`);
  });
});
