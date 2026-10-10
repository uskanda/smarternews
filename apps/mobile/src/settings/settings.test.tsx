import { screen, userEvent, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
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
