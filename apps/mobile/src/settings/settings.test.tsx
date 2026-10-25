import AsyncStorage from "@react-native-async-storage/async-storage";
import { screen, userEvent, waitFor, within } from "@testing-library/react-native";
import { Linking } from "react-native";
import { colors } from "../theme/tokens";
import { loadConnection } from "../connection/store";
import { renderApp } from "../testing/app";
import { nodeFetch } from "../testing/fetch";
import { eventually } from "../testing/queries";
import { makeServer, type TestServer } from "../testing/server";

const press = async (name: string | RegExp) => userEvent.setup().press(await screen.findByRole("button", { name }));

/** Starts a run through the API, as "run now" does. The test server never finishes a run by itself. */
async function startRun(server: TestServer, categoryId: number): Promise<number> {
  const response = await nodeFetch(`${server.url}/api/v1/categories/${categoryId}/runs`, { method: "POST", headers: { authorization: `Bearer ${server.token}` } });
  return ((await response.json()) as { id: number }).id;
}

const finish = (server: TestServer, runId: number, outcome: Record<string, unknown> = {}) =>
  server.core("finishRun", runId, {
    status: "succeeded",
    finishedAt: server.now().toISOString(),
    collected: 5,
    rejected: 3,
    articlesCreated: 2,
    articlesUpdated: 0,
    llmCalls: 4,
    failures: [],
    ...outcome,
  });

describe("reader information", () => {
  it("is saved from the app and is then what the server holds", async () => {
    const server = await makeServer();
    await server.core("updateSettings", { readerInfo: "Runs widgets in production." });
    await renderApp({ server, url: "/settings/reader-info" });
    const user = userEvent.setup();

    const field = await screen.findByDisplayValue("Runs widgets in production.");
    await user.type(field, " Rides a bicycle.");
    await user.press(screen.getByRole("button", { name: "保存する" }));

    expect(await screen.findByText("保存しました")).toBeOnTheScreen();
    await eventually(async () => expect(((await server.core("getSettings")) as { readerInfo: string }).readerInfo).toBe("Runs widgets in production. Rides a bicycle."));
  });

  it("asks before leaving with a change that was not saved, and keeps the text when the user stays", async () => {
    const server = await makeServer();
    await server.core("updateSettings", { readerInfo: "Before." });
    await renderApp({ server, url: "/settings/reader-info" });
    const user = userEvent.setup();
    await user.type(await screen.findByDisplayValue("Before."), " Unsaved.");

    await user.press(screen.getByRole("button", { name: "設定へ戻る" }));

    expect(await screen.findByText("保存していない変更があります")).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "編集を続ける" }));
    expect(screen.getByDisplayValue("Before. Unsaved.")).toBeOnTheScreen();
    expect(((await server.core("getSettings")) as { readerInfo: string }).readerInfo).toBe("Before.");
  });

  it("leaves without saving when the user says so", async () => {
    const server = await makeServer();
    await server.core("updateSettings", { readerInfo: "Before." });
    await renderApp({ server, url: "/settings/reader-info" });
    const user = userEvent.setup();
    await user.type(await screen.findByDisplayValue("Before."), " Unsaved.");

    await user.press(screen.getByRole("button", { name: "設定へ戻る" }));
    await user.press(await screen.findByRole("button", { name: "変更を捨てる" }));

    await waitFor(() => expect(screen.queryByDisplayValue("Before. Unsaved.")).toBeNull());
    expect(await screen.findByRole("header", { name: "設定" })).toBeOnTheScreen();
    expect(((await server.core("getSettings")) as { readerInfo: string }).readerInfo).toBe("Before.");
  });

  it("leaves at once when nothing was changed", async () => {
    const server = await makeServer();
    await renderApp({ server, url: "/settings/reader-info" });
    await screen.findByLabelText("読み手情報");

    await press("設定へ戻る");

    expect(await screen.findByRole("header", { name: "設定" })).toBeOnTheScreen();
    expect(screen.queryByLabelText("読み手情報")).toBeNull();
    expect(screen.queryByText("保存していない変更があります")).toBeNull();
  });
});

describe("the runs of each category", () => {
  it("shows the state, the end time and the number of articles of the latest run", async () => {
    const server = await makeServer("2026-03-01T06:00:00.000Z");
    const category = await server.category("Category A");
    await finish(server, await startRun(server, category.id));
    await renderApp({ server, url: "/settings" });

    expect(await screen.findByLabelText("Category A。成功。2026年3月1日 06:00 に終了。記事2件")).toBeOnTheScreen();
  });

  it("does not present a status line as a button when there is nothing to open", async () => {
    const server = await makeServer();
    await server.category("Category B");
    await renderApp({ server, url: "/settings" });

    await screen.findByLabelText("Category B。まだ実行していません");
    expect(screen.queryByRole("button", { name: /Category B。/ })).toBeNull();
  });

  it("says that a category has not been run yet", async () => {
    const server = await makeServer();
    await server.category("Category B");
    await renderApp({ server, url: "/settings" });

    expect(await screen.findByLabelText("Category B。まだ実行していません")).toBeOnTheScreen();
  });

  it("shows what failed when the latest run failed in part", async () => {
    const server = await makeServer();
    const category = await server.category("Category A");
    await finish(server, await startRun(server, category.id), {
      status: "partial",
      failures: [{ stage: "feed", target: "https://example.org/feed.xml", message: "HTTP status 500" }],
    });
    await renderApp({ server, url: "/settings" });

    await press(/Category A。一部失敗/);

    expect(await screen.findByText("フィード")).toBeOnTheScreen();
    expect(screen.getByText("https://example.org/feed.xml")).toBeOnTheScreen();
    expect(screen.getByText("HTTP status 500")).toBeOnTheScreen();
  });

  it("starts a run, cannot start a second one meanwhile, and shows the result without being asked", async () => {
    const server = await makeServer();
    const category = await server.category("Category A");
    await renderApp({ server, url: "/settings" });

    await press("Category Aをいま実行");

    expect(await screen.findByLabelText(/^Category A。実行中/)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Category Aをいま実行" })).toBeDisabled();
    const [run] = (await server.core("listRuns", { limit: 1 })) as Array<{ id: number; categoryId: number; trigger: string }>;
    expect(run).toMatchObject({ categoryId: category.id, trigger: "manual" });

    await finish(server, run!.id, { articlesCreated: 3 });

    expect(await screen.findByLabelText(/^Category A。成功。.*記事3件$/)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Category Aをいま実行" })).toBeEnabled();
  }, 30_000);
});

describe("the connection", () => {
  it("shows the server's URL and the version of the app", async () => {
    const server = await makeServer();
    await renderApp({ server, url: "/settings" });

    expect(await screen.findByText(server.url)).toBeOnTheScreen();
    expect(screen.getByText(/^版 \d+\.\d+\.\d+/)).toBeOnTheScreen();
  });

  it("opens the web app of the connected server in the device's browser", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    const server = await makeServer();
    await renderApp({ server, url: "/settings" });

    await press("Webの画面を開く");

    expect(open).toHaveBeenCalledWith(server.url);
    open.mockRestore();
  });

  it("forgets the server after the user confirms, and shows the connection screen", async () => {
    const server = await makeServer();
    await server.article((await server.category()).id, { title: "A story" });
    await renderApp({ server, url: "/settings" });

    await press("接続を解除する");
    await press("解除する");

    expect(await screen.findByRole("button", { name: "QRコードを読み取る" })).toBeOnTheScreen();
    expect(await loadConnection()).toBeNull();
    expect(screen.queryByText("A story")).toBeNull();
  });

  it("keeps the connection when the user cancels", async () => {
    const server = await makeServer();
    await renderApp({ server, url: "/settings" });

    await press("接続を解除する");
    await press("やめる");

    expect(await screen.findByRole("header", { name: "設定" })).toBeOnTheScreen();
    expect(await loadConnection()).toEqual({ url: server.url, token: server.token });
  });
});

describe("the colour scheme", () => {
  const radio = (name: string) => screen.findByRole("radio", { name });
  const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...[style].flat(5).filter(Boolean)) as Record<string, unknown>;
  const headingColor = async () => flat((await screen.findAllByRole("header"))[0]!.props.style).color;

  it("offers following the device and the three schemes, read out with their names and which one is chosen", async () => {
    await renderApp({ url: "/settings" });

    expect(await radio("端末に従う")).toBeChecked();
    // The group is not a stop of its own for a screen reader: it names what the four rows choose between.
    expect(screen.getByLabelText("配色").props.accessibilityRole).toBe("radiogroup");
    for (const name of ["ライト", "ダーク", "ダークブルー"]) expect(await radio(name)).not.toBeChecked();
  });

  it("draws the settings in the chosen scheme at once, and the list the user goes back to", async () => {
    await renderApp({ url: "/settings" });
    expect(await headingColor()).toBe(colors.light["on-surface"]);

    await userEvent.setup().press(await radio("ダーク"));

    await waitFor(async () => expect(await radio("ダーク")).toBeChecked());
    expect(await radio("端末に従う")).not.toBeChecked();
    expect(await headingColor()).toBe(colors.dark["on-surface"]);

    await press("一覧へ戻る");
    await screen.findByTestId("article-list");
    expect(await headingColor()).toBe(colors.dark["on-surface"]);
  });

  it("is still chosen after the app was closed and opened again", async () => {
    const server = await makeServer();
    const first = await renderApp({ server, url: "/settings" });
    await userEvent.setup().press(await radio("ダークブルー"));
    await waitFor(async () => expect(await radio("ダークブルー")).toBeChecked());
    first.unmount();
    require("../theme/store").resetThemeState();

    await renderApp({ server, url: "/settings" });

    await waitFor(async () => expect(await radio("ダークブルー")).toBeChecked());
    expect(await headingColor()).toBe(colors.darkblue["on-surface"]);
  });
});

describe("the settings of this device", () => {
  const toggle = () => screen.findByRole("switch", { name: "スクロールした記事を既読にする" });
  const section = (title: string) => screen.getByTestId(`section-${title}`);

  it("holds the colour scheme and the switch, says they stay on this device, and leaves the notifications where they were", async () => {
    await renderApp({ url: "/settings" });
    await toggle();

    const device = section("この端末の設定");
    expect(within(device).getByLabelText("配色").props.accessibilityRole).toBe("radiogroup");
    expect(within(device).getByRole("switch", { name: "スクロールした記事を既読にする" })).toBeOnTheScreen();
    expect(within(device).getByText(/この端末だけに保存し、サーバーには送りません/)).toBeOnTheScreen();
    expect(within(section("通知")).getByLabelText("通知").props.accessibilityRole).toBe("radiogroup");
    expect(within(device).queryByLabelText("通知")).toBeNull();
    expect(screen.queryByTestId("section-配色")).toBeNull();
  });

  it("reads the switch out with its name, what it does, and whether it is on", async () => {
    await renderApp({ url: "/settings" });

    expect(await toggle()).not.toBeChecked();
    expect((await toggle()).props.accessibilityHint).toMatch(/一覧の上端を越えた記事を既読にします/);
    await userEvent.setup().press(await toggle());
    await waitFor(async () => expect(await toggle()).toBeChecked());
  });

  it("is off until the stored setting has been read", async () => {
    await AsyncStorage.setItem("smarternews.scrollRead", "on");
    let finish: () => void = () => {};
    const gate = new Promise<void>((resolve) => (finish = resolve));
    // The storage of the tests is a mock already: its own reading is kept, and held back for this key.
    const getItem = AsyncStorage.getItem as jest.Mock;
    const read = getItem.getMockImplementation()!;
    getItem.mockImplementation(async (key: string) => {
      if (key === "smarternews.scrollRead") await gate;
      return read(key);
    });
    try {
      await renderApp({ url: "/settings" });

      expect(await toggle()).not.toBeChecked();
      finish();
      await waitFor(async () => expect(await toggle()).toBeChecked());
    } finally {
      getItem.mockImplementation(read);
    }
  });

  it("is still on after the app was closed and opened again, and after leaving the server and connecting again", async () => {
    const server = await makeServer();
    const first = await renderApp({ server, url: "/settings" });
    await userEvent.setup().press(await toggle());
    await waitFor(async () => expect(await toggle()).toBeChecked());
    first.unmount();
    require("./scroll-read").resetScrollReadState();

    const second = await renderApp({ server, url: "/settings" });
    await waitFor(async () => expect(await toggle()).toBeChecked());
    await press("接続を解除する");
    await press("解除する");
    await screen.findByRole("button", { name: "QRコードを読み取る" });
    second.unmount();
    require("./scroll-read").resetScrollReadState();

    await renderApp({ server, url: "/settings" });
    await waitFor(async () => expect(await toggle()).toBeChecked());
  });
});
