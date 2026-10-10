import { act, screen, userEvent, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";
import { renderApp } from "../testing/app";
import { MINUTE, rowTitles } from "../testing/queries";
import { makeServer } from "../testing/server";

async function openDrawer() {
  await userEvent.setup().press(await screen.findByRole("button", { name: "項目を開く" }));
}

describe("the drawer", () => {
  it("lists the three fixed views, the enabled categories and the settings", async () => {
    const server = await makeServer();
    await server.category("Security");
    const hidden = await server.category("Hidden");
    await server.core("updateCategory", hidden.id, { enabled: false });
    await renderApp({ server });

    await openDrawer();

    for (const name of ["すべて", "スター", "Security", "設定"]) {
      expect(await screen.findByRole("button", { name })).toBeOnTheScreen();
    }
    expect(screen.getByRole("button", { name: /^未読/ })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /Hidden/ })).toBeNull();
  });

  it("shows the unread count beside a category that has unread articles, and no number beside one that has none", async () => {
    const server = await makeServer();
    const a = await server.category("Category A");
    await server.category("Category B");
    await server.article(a.id);
    await server.article(a.id);
    await renderApp({ server });

    await openDrawer();

    expect(await screen.findByRole("button", { name: "Category A、未読2件" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Category B" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "未読、未読2件" })).toBeOnTheScreen();
  });

  it("keeps its items away from a screen reader while it is closed", async () => {
    const server = await makeServer();
    await server.category("Security");
    await renderApp({ server });
    await screen.findByRole("header", { name: "未読" });

    expect(screen.queryByRole("button", { name: "すべて" })).toBeNull();
    expect(screen.queryByRole("button", { name: "設定" })).toBeNull();

    await openDrawer();
    expect(await screen.findByRole("button", { name: "すべて" })).toBeOnTheScreen();
  });

  it("shows the list of the item that is chosen", async () => {
    const server = await makeServer();
    const a = await server.category("Category A");
    const b = await server.category("Category B");
    await server.article(a.id, { title: "In A" });
    await server.article(b.id, { title: "In B" });
    await renderApp({ server });
    await screen.findByText("In A");

    await openDrawer();
    await userEvent.setup().press(await screen.findByRole("button", { name: /^Category B/ }));

    await waitFor(() => expect(rowTitles()).toEqual(["In B"]));
    expect(screen.getByRole("header", { name: "Category B" })).toBeOnTheScreen();
  });
});

describe("staying up to date", () => {
  it("fetches the counts and the list again when the app comes back to the foreground", async () => {
    const server = await makeServer();
    const category = await server.category();
    await server.article(category.id, { title: "Old" });
    await renderApp({ server });
    await screen.findByText("Old");

    await server.advance(MINUTE);
    for (const title of ["New 1", "New 2", "New 3"]) await server.article(category.id, { title });
    const handlers = (AppState.addEventListener as jest.Mock).mock.calls.filter(([type]) => type === "change").map(([, handler]) => handler as (state: string) => void);
    expect(handlers.length).toBeGreaterThan(0);
    await act(async () => handlers.forEach((handler) => handler("background")));
    await act(async () => handlers.forEach((handler) => handler("active")));

    await waitFor(() => expect(rowTitles()).toEqual(["New 3", "New 2", "New 1", "Old"]));
    await openDrawer();
    expect(await screen.findByRole("button", { name: "未読、未読4件" })).toBeOnTheScreen();
  });

  it("fetches the list again when it is pulled down", async () => {
    const server = await makeServer();
    const category = await server.category();
    await server.article(category.id, { title: "Old" });
    await renderApp({ server });
    await screen.findByText("Old");

    await server.advance(MINUTE);
    await server.article(category.id, { title: "New 1" });
    await server.article(category.id, { title: "New 2" });
    const { refreshControl } = screen.getByTestId("article-list").props as { refreshControl: { props: { onRefresh: () => void } } };
    await act(async () => refreshControl.props.onRefresh());

    await waitFor(() => expect(rowTitles()).toEqual(["New 2", "New 1", "Old"]));
  });
});

describe("when the server cannot be reached", () => {
  it("says so, offers to try again, and shows the list once the server answers", async () => {
    const server = await makeServer();
    await server.article((await server.category()).id, { title: "A story" });
    let down = true;
    await renderApp({ server, offline: () => down });

    expect(await screen.findByText(/サーバーに接続できません/)).toBeOnTheScreen();
    down = false;
    await userEvent.setup().press(screen.getByRole("button", { name: "やり直す" }));

    expect(await screen.findByText("A story")).toBeOnTheScreen();
  });
});

describe("times", () => {
  it("are shown in the time zone of the server's settings, not the device's", async () => {
    const server = await makeServer("2026-03-01T20:00:00.000Z");
    await server.core("updateSettings", { timeZone: "Asia/Tokyo" });
    await server.article((await server.category()).id, { title: "Evening story" });
    await renderApp({ server });

    // 20:00 UTC is 05:00 on the next day in Tokyo; the device runs in UTC.
    expect(await screen.findByRole("button", { name: /Evening story.*05:00/ })).toBeOnTheScreen();
  });
});

describe("controls", () => {
  it("gives the buttons of the list screen a name and a size of at least 48dp", async () => {
    const server = await makeServer();
    await server.article((await server.category()).id);
    await renderApp({ server });

    for (const name of ["項目を開く", "すべて既読にする"]) {
      const button = await screen.findByRole("button", { name });
      const style = (button.props.style ?? {}) as { width?: number; height?: number; minWidth?: number; minHeight?: number };
      expect(style.width ?? style.minWidth).toBeGreaterThanOrEqual(48);
      expect(style.height ?? style.minHeight).toBeGreaterThanOrEqual(48);
    }
  });
});
