import { act, fireEvent, screen, userEvent, waitFor } from "@testing-library/react-native";
import { State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { renderApp } from "../testing/app";
import { eventually } from "../testing/queries";
import { makeServer, type TestServer } from "../testing/server";

const press = async (name: string | RegExp) => userEvent.setup().press(await screen.findByRole("button", { name }));
const openDrawer = () => press("項目を開く");
const ROW = 48;

/** A (feeds X, Y, Z), B (feed P), C (no feed), an event category and the loose feed L. */
async function seeded() {
  const server = await makeServer();
  const a = await server.category("A");
  const b = await server.category("B");
  const c = await server.category("C");
  const events = await server.category("Events", "event");
  const x = await server.feed("X", a.id);
  const y = await server.feed("Y", a.id);
  const z = await server.feed("Z", a.id);
  const p = await server.feed("P", b.id);
  const l = await server.feed("L");
  return { server, a, b, c, events, x, y, z, p, l };
}

/** The categories and what is below them, as the drawer shows them. */
const rows = () => screen.getAllByTestId(/^nav-row-/).map((node) => String(node.props.testID).replace("nav-row-", ""));

/** A test device lays nothing out: every row is 48 high, one below the other. */
async function layOut() {
  await act(async () => {
    screen.getAllByTestId(/^nav-row-/).forEach((node, index) => {
      fireEvent(node, "layout", { nativeEvent: { layout: { x: 0, y: index * ROW, width: 300, height: ROW } } });
    });
  });
}
const mid = (key: string) => rows().indexOf(key) * ROW + ROW / 2;

async function ready(server: TestServer) {
  await renderApp({ server });
  await openDrawer();
  await waitFor(() => expect(rows()).toHaveLength(12));
  await layOut();
}

type DragHandlers = {
  onStart: (event: { absoluteY: number }) => void;
  onUpdate: (event: { absoluteY: number }) => void;
  onFinalize: (event: { absoluteY: number }, success: boolean) => void;
};

/**
 * A long press on a row, then the finger moves to the heights given and stays `hold` ms at the last one. The
 * gesture's callbacks are called one by one: the library's own helper can only play a gesture to its end.
 */
async function drag(key: string, to: number[], hold = 0) {
  const { handlers } = getByGestureTestId(`drag-${key}`) as unknown as { handlers: DragHandlers };
  await act(async () => {
    handlers.onStart({ absoluteY: mid(key) });
    for (const y of to) handlers.onUpdate({ absoluteY: y });
  });
  if (hold > 0) await act(async () => new Promise<void>((resolve) => setTimeout(resolve, hold)));
  return async () => {
    await act(async () => handlers.onFinalize({ absoluteY: to.at(-1)! }, true));
  };
}

const names = async (server: TestServer) => (await server.core<Array<{ name: string }>>("listCategories")).map((category) => category.name);
const feedsOf = async (server: TestServer, categoryId: number | null) =>
  (await server.core<Array<{ title: string; categoryId: number | null }>>("listFeeds")).filter((feed) => feed.categoryId === categoryId).map((feed) => feed.title);

describe("the order of the drawer", () => {
  it("shows categories and feeds in the order the server keeps", async () => {
    const { server, a, b, x, y } = await seeded();
    await server.core("moveCategory", b.id, a.id);
    await server.core("moveFeed", y.id, { categoryId: a.id, before: x.id });
    await renderApp({ server });
    await openDrawer();

    await waitFor(() =>
      expect(rows().slice(0, 8)).toEqual([`category-${b.id}`, `category-${b.id}-generated`, expect.stringMatching(/^feed-/), `category-${a.id}`, `category-${a.id}-generated`, `feed-${y.id}`, `feed-${x.id}`, expect.stringMatching(/^feed-/)]),
    );
  });
});

describe("dragging in the drawer after a long press", () => {
  it("moves a category to where it is let go, with a line at that place while it is held", async () => {
    const { server, a, c } = await seeded();
    await ready(server);

    const letGo = await drag(`category-${c.id}`, [mid(`category-${a.id}`) - 10]);
    expect(screen.getByTestId("nav-drop-line")).toHaveStyle({ top: -1, height: 2 });
    expect(screen.getByTestId("nav-dragged")).toHaveTextContent("C");
    await letGo();

    expect(screen.queryByTestId("nav-drop-line")).toBeNull();
    await waitFor(() => expect(rows()[0]).toBe(`category-${c.id}`));
    await eventually(async () => expect(await names(server)).toEqual(["C", "A", "B", "Events"]));
  });

  it("moves a feed within its category, played as a whole gesture", async () => {
    const { server, a, x, z } = await seeded();
    await ready(server);

    const y = (value: number) => ({ absoluteY: value });
    await act(async () => {
      fireGestureHandler(getByGestureTestId(`drag-feed-${x.id}`), [
        { state: State.BEGAN, ...y(mid(`feed-${x.id}`)) },
        { state: State.ACTIVE, ...y(mid(`feed-${x.id}`)) },
        y(mid(`feed-${z.id}`) + 10),
        { state: State.END, ...y(mid(`feed-${z.id}`) + 10) },
      ]);
    });

    await eventually(async () => expect(await feedsOf(server, a.id)).toEqual(["Y", "Z", "X"]));
  });

  it("leaves a feed where it was when it is let go over another category at once", async () => {
    const { server, a, x, p } = await seeded();
    await ready(server);

    const letGo = await drag(`feed-${x.id}`, [mid(`feed-${p.id}`)]);
    expect(screen.queryByTestId("nav-drop-line")).toBeNull();
    await letGo();
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 100)));

    expect(await feedsOf(server, a.id)).toEqual(["X", "Y", "Z"]);
  });

  it("puts a feed into another category after it stayed over it for half a second", async () => {
    const { server, a, b, x, p } = await seeded();
    await ready(server);

    const letGo = await drag(`feed-${x.id}`, [mid(`feed-${p.id}`) - 10], 600);
    expect(screen.getByTestId(`nav-row-category-${b.id}`)).toHaveStyle({ outlineWidth: 2 });
    await letGo();

    await eventually(async () => expect(await feedsOf(server, b.id)).toEqual(["X", "P"]));
    expect(await feedsOf(server, a.id)).toEqual(["Y", "Z"]);
  });

  it("opens a folded category that a feed stays over", async () => {
    const { server, b, x } = await seeded();
    await renderApp({ server });
    await openDrawer();
    await press("Bの下の項目");
    await waitFor(() => expect(rows()).toHaveLength(10));
    await layOut();

    const letGo = await drag(`feed-${x.id}`, [mid(`category-${b.id}`)], 600);
    expect(screen.getByRole("button", { name: "Bの下の項目" })).toBeExpanded();
    await letGo();

    await eventually(async () => expect(await feedsOf(server, b.id)).toContain("X"));
  });

  it("never puts a feed into an event category", async () => {
    const { server, a, events, x } = await seeded();
    await ready(server);

    await (await drag(`feed-${x.id}`, [mid(`category-${events.id}`)], 600))();
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 100)));

    expect(await feedsOf(server, a.id)).toEqual(["X", "Y", "Z"]);
  });

  it("has no drag on the entries that stay in place", async () => {
    const { server, a } = await seeded();
    await ready(server);

    expect(() => getByGestureTestId("drag-uncategorized")).toThrow();
    expect(() => getByGestureTestId(`drag-category-${a.id}-generated`)).toThrow();
    expect(getByGestureTestId(`drag-category-${a.id}`)).toBeTruthy();
  });

  it("still opens an entry on a short press", async () => {
    const { server, x } = await seeded();
    await ready(server);

    await press("X");

    expect(await screen.findByRole("header", { name: "X" })).toBeOnTheScreen();
    expect(await feedsOf(server, (await server.core<{ categoryId: number }>("getFeed", x.id)).categoryId)).toEqual(["X", "Y", "Z"]);
  });

  it("puts the drawer back and says so when the move cannot be saved", async () => {
    const { server, a, c } = await seeded();
    let offline = false;
    await renderApp({ server, offline: () => offline });
    await openDrawer();
    await waitFor(() => expect(rows()).toHaveLength(12));
    await layOut();

    offline = true;
    await (await drag(`category-${c.id}`, [mid(`category-${a.id}`) - 10]))();

    expect(await screen.findByText("並べ替えられませんでした。もう一度試してください。")).toBeOnTheScreen();
    offline = false;
    await waitFor(() => expect(rows()[0]).toBe(`category-${a.id}`));
  });
});
