import { insertFeed, listCategories, listFeeds } from "@smarternews/core";
import { seedFeedArticle } from "@smarternews/core/testing";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";

const nav = () => screen.getByRole("navigation", { name: "項目" });
const named = (name: string) => new RegExp(`^${name}\\s*\\d*$`);
const link = (name: string) => within(nav()).getByRole("link", { name: named(name) });
/** The categories and what is below them, as labels in order. */
const groupLines = () =>
  [...nav().querySelectorAll<HTMLElement>("[data-nav-key]")].map((row) => `${row.closest("ul ul") ? "  " : ""}${row.querySelector("a")!.textContent!.replace(/\d+$/, "").trim()}`);

function feedOf(server: TestServer, title: string, categoryId: number | null) {
  return insertFeed(server.db, { url: `https://${title.toLowerCase()}.example.org/feed.xml`, title, categoryId }, server.clock);
}

/** A (feeds X, Y, Z), B (feed P), C (no feed), an event category and the loose feed L. */
function seeded() {
  const server = makeServer();
  const a = server.category("A");
  const b = server.category("B");
  const c = server.category("C");
  const events = server.category("Events", "event");
  const x = feedOf(server, "X", a.id);
  const y = feedOf(server, "Y", a.id);
  const z = feedOf(server, "Z", a.id);
  const p = feedOf(server, "P", b.id);
  const l = feedOf(server, "L", null);
  return { server, a, b, c, events, x, y, z, p, l };
}

const START = ["A", "  AI生成", "  X", "  Y", "  Z", "B", "  AI生成", "  P", "C", "Events", "未分類", "  L"];

async function ready(options: Parameters<typeof renderApp>[0]) {
  const view = renderApp(options);
  await waitFor(() => expect(groupLines()).toEqual(START));
  return view;
}

/** jsdom lays nothing out: every row of the list is 20px high, in document order, from 100px down. */
function layOut() {
  const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const rows = [...nav().querySelectorAll("[data-nav-key]")];
    const index = rows.findIndex((row) => row === this || row.contains(this));
    const top = index === -1 ? 0 : 100 + index * 20;
    const height = index === -1 ? 1000 : 20;
    return { top, bottom: top + height, height, left: 0, right: 200, width: 200, x: 0, y: top, toJSON: () => ({}) };
  });
  onTestFinished(() => spy.mockRestore());
}

/** The height of the middle of a row, by its place among the rows that show. */
const mid = (label: string, nth = 0) => {
  const rows = [...nav().querySelectorAll<HTMLElement>("[data-nav-key]")];
  const matches = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.querySelector("a")!.textContent!.replace(/\d+$/, "").trim() === label);
  return 100 + matches[nth]!.index * 20 + 10;
};

const mouse = (clientY: number, extra: Record<string, unknown> = {}) => ({ clientX: 50, clientY, button: 0, pointerType: "mouse", pointerId: 1, bubbles: true, ...extra });

function press(name: string, nth = 0) {
  const target = within(nav()).getAllByRole("link", { name: named(name) })[nth]!;
  fireEvent.pointerDown(target, mouse(mid(name, nth)));
  return target;
}
const dragTo = (y: number) => act(() => void fireEvent.pointerMove(document.body, mouse(y, { buttons: 1 })));
const release = (y: number) => act(() => void fireEvent.pointerUp(document.body, mouse(y)));
const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

describe("the menu of an entry", () => {
  it("opens on a right click with what a feed can do, and has none for entries that stay in place", async () => {
    const { server } = seeded();
    await ready({ server, route: "/all" });

    fireEvent.contextMenu(link("Y"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["上へ移動", "下へ移動", "登録を解除"]);
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    fireEvent.contextMenu(link("A"));
    expect(within(await screen.findByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["上へ移動", "下へ移動"]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    for (const fixed of ["未読", "未分類"]) {
      fireEvent.contextMenu(link(fixed));
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    }
    fireEvent.contextMenu(within(nav()).getAllByRole("link", { name: /^AI生成/ })[1]!);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("cannot move the first entry up or the last one down", async () => {
    const { server } = seeded();
    await ready({ server, route: "/all" });

    fireEvent.contextMenu(link("X"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "上へ移動" })).toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByRole("menuitem", { name: "下へ移動" })).not.toHaveAttribute("aria-disabled");
  });

  it("opens from the keyboard, moves the category down, and leaves the focus on it", async () => {
    const { server } = seeded();
    const { user } = await ready({ server, route: "/all" });

    link("A").focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    await screen.findByRole("menu");
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    await waitFor(() => expect(groupLines().filter((line) => !line.startsWith(" "))).toEqual(["B", "A", "C", "Events", "未分類"]));
    await waitFor(() => expect(listCategories(server.db).map((category) => category.name)).toEqual(["B", "A", "C", "Events"]));
    await waitFor(() => expect(link("A")).toHaveFocus());
  });

  it("opens from the fold button of the row as well", async () => {
    const { server } = seeded();
    const { user } = await ready({ server, route: "/all" });
    within(nav()).getByRole("button", { name: "Aの下の項目" }).focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(await screen.findByRole("menu", { name: "Aの操作" })).toBeInTheDocument();
  });

  it("opens with the menu key as well", async () => {
    const { server } = seeded();
    const { user } = await ready({ server, route: "/all" });
    link("Y").focus();
    await user.keyboard("{ContextMenu}");
    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("moves a feed up within its category", async () => {
    const { server, a } = seeded();
    const { user } = await ready({ server, route: "/all" });

    fireEvent.contextMenu(link("Z"));
    await user.click(await screen.findByRole("menuitem", { name: "上へ移動" }));

    await waitFor(() => expect(groupLines().slice(0, 5)).toEqual(["A", "  AI生成", "  X", "  Z", "  Y"]));
    await waitFor(() =>
      expect(
        listFeeds(server.db)
          .filter((feed) => feed.categoryId === a.id)
          .map((feed) => feed.title),
      ).toEqual(["X", "Z", "Y"]),
    );
  });

  it("puts the list back and says so when the move cannot be saved", async () => {
    const { server } = seeded();
    let offline = false;
    const { user } = await ready({ server, route: "/all", offline: () => offline });

    fireEvent.contextMenu(link("Z"));
    const item = await screen.findByRole("menuitem", { name: "上へ移動" });
    offline = true;
    await user.click(item);
    expect(await screen.findByText("並べ替えられませんでした。もう一度試してください。")).toBeInTheDocument();
    offline = false;
    await waitFor(() => expect(groupLines()).toEqual(START));
  });
});

describe("unsubscribing from the menu", () => {
  it("asks first, and removes the feed on yes", async () => {
    const { server, y } = seeded();
    seedFeedArticle(server.db, y.id, { starred: true });
    const { user } = await ready({ server, route: "/all" });

    fireEvent.contextMenu(link("Y"));
    await user.click(await screen.findByRole("menuitem", { name: "登録を解除" }));
    const dialog = await screen.findByRole("alertdialog", { name: "購読フィードを削除しますか" });
    expect(dialog).toHaveTextContent("「Y」と、その配信記事1件が消えます。うち1件にはスターが付いています。元に戻せません。");
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));

    await waitFor(() => expect(groupLines().slice(0, 4)).toEqual(["A", "  AI生成", "  X", "  Z"]));
    expect(listFeeds(server.db).map((feed) => feed.title)).not.toContain("Y");
    // The row is gone; the focus goes to the first entry instead of nowhere.
    await waitFor(() => expect(link("未読")).toHaveFocus());
  });

  it("keeps the feed on no", async () => {
    const { server } = seeded();
    const { user } = await ready({ server, route: "/all" });

    fireEvent.contextMenu(link("Y"));
    await user.click(await screen.findByRole("menuitem", { name: "登録を解除" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "やめる" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(groupLines()).toEqual(START);
    await waitFor(() => expect(link("Y")).toHaveFocus());
  });

  it("opens the unread list when the feed that is open goes away", async () => {
    const { server, y } = seeded();
    const { user, path } = await ready({ server, route: `/f/${y.id}` });

    fireEvent.contextMenu(link("Y"));
    await user.click(await screen.findByRole("menuitem", { name: "登録を解除" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "削除する" }));

    await waitFor(() => expect(path()).toBe("/unread"));
  });
});

describe("dragging an entry", () => {
  it("opens the entry when the pointer hardly moved", async () => {
    const { server, y } = seeded();
    const { user, path } = await ready({ server, route: "/all" });
    layOut();

    const target = press("Y");
    await dragTo(mid("Y") + 3);
    await release(mid("Y") + 3);
    await user.click(target);

    expect(path()).toBe(`/f/${y.id}`);
    expect(groupLines()).toEqual(START);
  });

  it("moves a category with what is below it, shows the place with a line, and does not open it", async () => {
    const { server } = seeded();
    const { path } = await ready({ server, route: "/all" });
    layOut();

    const target = press("C");
    await dragTo(mid("A") - 5);
    const line = nav().querySelector<HTMLElement>("[data-drop-line]")!;
    expect(line).toBeInTheDocument();
    expect(line.style.top).toBe("100px");
    // A browser sends the click right after the button comes up, before anything else runs.
    await act(() => {
      fireEvent.pointerUp(document.body, mouse(mid("A") - 5));
      fireEvent.click(target);
    });

    expect(nav().querySelector("[data-drop-line]")).not.toBeInTheDocument();
    await waitFor(() => expect(groupLines().slice(0, 6)).toEqual(["C", "A", "  AI生成", "  X", "  Y", "  Z"]));
    await waitFor(() => expect(listCategories(server.db).map((category) => category.name)).toEqual(["C", "A", "B", "Events"]));
    expect(path()).toBe("/all");
  });

  it("moves a feed within its category, and never above the generated articles", async () => {
    const { server, a } = seeded();
    await ready({ server, route: "/all" });
    layOut();
    const inA = () =>
      listFeeds(server.db)
        .filter((feed) => feed.categoryId === a.id)
        .map((feed) => feed.title);

    press("X");
    await dragTo(mid("Z") + 5);
    await release(mid("Z") + 5);
    await waitFor(() => expect(inA()).toEqual(["Y", "Z", "X"]));

    press("X");
    await dragTo(mid("A"));
    await release(mid("A"));
    await waitFor(() => expect(inA()).toEqual(["X", "Y", "Z"]));
    expect(groupLines().slice(0, 3)).toEqual(["A", "  AI生成", "  X"]);
  });

  it("gives up on Escape", async () => {
    const { server } = seeded();
    await ready({ server, route: "/all" });
    layOut();

    press("C");
    await dragTo(mid("A") - 5);
    await act(() => void fireEvent.keyDown(document.body, { key: "Escape" }));
    expect(nav().querySelector("[data-drop-line]")).not.toBeInTheDocument();
    await release(mid("A") - 5);

    expect(groupLines()).toEqual(START);
    expect(listCategories(server.db).map((category) => category.name)).toEqual(["A", "B", "C", "Events"]);
  });

  it("gives up when it is let go far to the side of the list", async () => {
    const { server } = seeded();
    await ready({ server, route: "/all" });
    layOut();

    press("C");
    await dragTo(mid("A") - 5);
    await act(() => void fireEvent.pointerMove(document.body, { ...mouse(mid("A") - 5, { buttons: 1 }), clientX: 900 }));
    expect(nav().querySelector("[data-drop-line]")).not.toBeInTheDocument();
    await act(() => void fireEvent.pointerUp(document.body, { ...mouse(mid("A") - 5), clientX: 900 }));

    expect(listCategories(server.db).map((category) => category.name)).toEqual(["A", "B", "C", "Events"]);
  });

  it("ends when the button came up out of sight", async () => {
    const { server } = seeded();
    await ready({ server, route: "/all" });
    layOut();

    press("C");
    await dragTo(mid("A") - 5);
    await act(() => void fireEvent.pointerMove(document.body, mouse(mid("A") - 5, { buttons: 0 })));

    expect(nav().querySelector("[data-drop-line]")).not.toBeInTheDocument();
    expect(document.body.style.userSelect).toBe("");
  });

  it("leaves a feed where it was when it is let go over another category at once", async () => {
    const { server, a } = seeded();
    await ready({ server, route: "/all" });
    layOut();

    press("X");
    await dragTo(mid("P"));
    expect(nav().querySelector("[data-drop-line]")).not.toBeInTheDocument();
    await release(mid("P"));
    await wait(50);

    expect(listFeeds(server.db).find((feed) => feed.title === "X")!.categoryId).toBe(a.id);
    expect(groupLines()).toEqual(START);
  });

  it("puts a feed into another category after it stayed over it for half a second", async () => {
    const { server, b } = seeded();
    await ready({ server, route: "/all" });
    layOut();

    press("X");
    await dragTo(mid("P") - 5);
    await wait(600);
    expect(nav().querySelector("[data-drop-armed]")).toHaveTextContent("B");
    expect(nav().querySelector("[data-drop-line]")).toBeInTheDocument();
    await release(mid("P") - 5);

    await waitFor(() => expect(groupLines()).toEqual(["A", "  AI生成", "  Y", "  Z", "B", "  AI生成", "  X", "  P", "C", "Events", "未分類", "  L"]));
    await waitFor(() => expect(listFeeds(server.db).find((feed) => feed.title === "X")!.categoryId).toBe(b.id));
  });

  it("opens a folded category that a feed stays over", async () => {
    const { server, b } = seeded();
    const { user } = await ready({ server, route: "/all" });
    await user.click(within(nav()).getByRole("button", { name: "Bの下の項目" }));
    layOut();

    press("X");
    await dragTo(mid("B"));
    await wait(600);
    expect(within(nav()).getByRole("button", { name: "Bの下の項目" })).toHaveAttribute("aria-expanded", "true");
    await release(mid("B"));

    await waitFor(() => expect(listFeeds(server.db).find((feed) => feed.title === "X")!.categoryId).toBe(b.id));
  });

  it("takes a feed out of every category, and not into an event category", async () => {
    const { server, a } = seeded();
    await ready({ server, route: "/all" });
    layOut();

    press("X");
    await dragTo(mid("Events"));
    await wait(600);
    expect(nav().querySelector("[data-drop-armed]")).not.toBeInTheDocument();
    await release(mid("Events"));
    await wait(50);
    expect(listFeeds(server.db).find((feed) => feed.title === "X")!.categoryId).toBe(a.id);

    press("X");
    await dragTo(mid("L") + 5);
    await wait(600);
    await release(mid("L") + 5);
    await waitFor(() => expect(listFeeds(server.db).find((feed) => feed.title === "X")!.categoryId).toBeNull());
    await waitFor(() => expect(groupLines().slice(-3)).toEqual(["未分類", "  L", "  X"]));
  });

  it("does not start from the entries that stay in place", async () => {
    const { server } = seeded();
    await ready({ server, route: "/all" });
    layOut();

    press("未分類");
    await dragTo(mid("A"));
    expect(nav().querySelector("[data-drop-line]")).not.toBeInTheDocument();
    await release(mid("A"));
    expect(groupLines()).toEqual(START);
  });
});

describe("the list of keys", () => {
  it("names the keys that open the menu of an entry", async () => {
    const { server } = seeded();
    const { user } = await ready({ server, route: "/all" });
    await user.keyboard("?");
    expect(await screen.findByRole("dialog", { name: "キー操作" })).toHaveTextContent("項目のメニューを開く");
  });
});
