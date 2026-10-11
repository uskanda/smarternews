import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { resetPaneState } from "../lib/panes.ts";
import { makeServer, renderApp } from "../testing/harness.tsx";
import { setViewport } from "../testing/setup.ts";

const navBorder = () => screen.findByRole("separator", { name: "項目の一覧の幅" });
const listBorder = () => screen.findByRole("separator", { name: "記事の一覧の幅" });
const widthOf = (border: HTMLElement) => Number.parseInt(border.parentElement!.style.width, 10);

/** Presses the border, moves the pointer by `dx` pixels in a few steps, and lets go. */
function drag(border: HTMLElement, dx: number) {
  fireEvent.pointerDown(border, { button: 0, clientX: 500, pointerId: 1 });
  fireEvent.pointerMove(border, { clientX: 500 + Math.round(dx / 2), pointerId: 1 });
  fireEvent.pointerMove(border, { clientX: 500 + dx, pointerId: 1 });
  fireEvent.pointerUp(border, { clientX: 500 + dx, pointerId: 1 });
}

function withArticle() {
  const server = makeServer();
  server.article(server.category("Tools").id, { title: "One" });
  return server;
}

describe("dragging the border of a pane", () => {
  it("widens the navigation by the distance dragged, and leaves the list as it was", async () => {
    renderApp({ server: withArticle() });
    drag(await navBorder(), 60);
    expect(widthOf(await navBorder())).toBe(260);
    expect(widthOf(await listBorder())).toBe(380);
  });

  it("narrows the list by the distance dragged", async () => {
    renderApp({ server: withArticle() });
    drag(await listBorder(), -50);
    expect(widthOf(await listBorder())).toBe(330);
  });

  it("stops at the widest and the narrowest the pane may be", async () => {
    renderApp({ server: withArticle() });
    drag(await navBorder(), 500);
    expect(widthOf(await navBorder())).toBe(400);
    drag(await navBorder(), -900);
    expect(widthOf(await navBorder())).toBe(160);
    drag(await listBorder(), -900);
    expect(widthOf(await listBorder())).toBe(280);
  });

  it("stops before the article would get narrower than its smallest width", async () => {
    renderApp({ server: withArticle(), width: 1100 });
    drag(await listBorder(), 600);
    // 1100 wide, 200 for the navigation, 360 kept for the article.
    expect(widthOf(await listBorder())).toBe(540);
  });

  it("does nothing after the pointer was let go", async () => {
    renderApp({ server: withArticle() });
    const border = await navBorder();
    drag(border, 40);
    fireEvent.pointerMove(border, { clientX: 900, pointerId: 1 });
    expect(widthOf(await navBorder())).toBe(240);
  });
});

describe("the keyboard on a border", () => {
  it("moves it by sixteen pixels for each press of an arrow key", async () => {
    const { user } = renderApp({ server: withArticle() });
    (await navBorder()).focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(widthOf(await navBorder())).toBe(232);
    await user.keyboard("{ArrowLeft}");
    expect(widthOf(await navBorder())).toBe(216);
  });

  it("does not move the selection of articles while a border has the focus", async () => {
    const { user, path } = renderApp({ server: withArticle() });
    await screen.findByRole("link", { name: /One/ });
    (await listBorder()).focus();
    await user.keyboard("{ArrowRight}");
    expect(widthOf(await listBorder())).toBe(396);
    // No article was opened by the key.
    expect(path()).not.toMatch(/\/\d+$/);
  });
});

describe("a double click on a border", () => {
  it("puts the pane back to its usual width", async () => {
    const { user } = renderApp({ server: withArticle() });
    drag(await navBorder(), 100);
    expect(widthOf(await navBorder())).toBe(300);
    await user.dblClick(await navBorder());
    expect(widthOf(await navBorder())).toBe(200);
  });
});

describe("the widths that were chosen", () => {
  it("are there again after a reload", async () => {
    const server = withArticle();
    const first = renderApp({ server });
    drag(await navBorder(), 60);
    drag(await listBorder(), -40);
    first.unmount();
    resetPaneState(); // a reload starts from what the browser stored

    renderApp({ server });

    expect(widthOf(await navBorder())).toBe(260);
    expect(widthOf(await listBorder())).toBe(340);
  });

  it("give way on a smaller window so that the article keeps its room, and come back on a larger one", async () => {
    renderApp({ server: withArticle(), width: 1920 });
    drag(await listBorder(), 400);
    expect(widthOf(await listBorder())).toBe(640);

    setViewport(1100);
    expect(widthOf(await listBorder())).toBe(540);

    setViewport(1920);
    expect(widthOf(await listBorder())).toBe(640);
  });
});

describe("what a border tells a screen reader", () => {
  it("is its name, the width now, and the narrowest and the widest it can be", async () => {
    renderApp({ server: withArticle() });
    const border = await navBorder();
    expect(border).toHaveAttribute("aria-orientation", "vertical");
    expect(border).toHaveAttribute("aria-valuenow", "200");
    expect(border).toHaveAttribute("aria-valuemin", "160");
    expect(border).toHaveAttribute("aria-valuemax", "400");
    expect(border).toHaveAttribute("tabindex", "0");
  });
});

describe("where the borders are", () => {
  it("has only the list's border where the navigation is behind a button", async () => {
    renderApp({ server: withArticle(), width: 900 });
    expect(await listBorder()).toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: "項目の一覧の幅" })).not.toBeInTheDocument();
  });

  it("has none where one pane fills the screen", async () => {
    renderApp({ server: withArticle(), width: 390 });
    await screen.findByRole("link", { name: /One/ });
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "記事の一覧" }).parentElement).not.toHaveAttribute("style");
  });
});
