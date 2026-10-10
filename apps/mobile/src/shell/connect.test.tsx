import AsyncStorage from "@react-native-async-storage/async-storage";
import { buildConnectLink } from "@smarternews/client";
import { fireEvent, screen, userEvent, waitFor } from "@testing-library/react-native";
import { lastUrl, loadConnection, saveConnection } from "../connection/store";
import { renderApp } from "../testing/app";
import { makeServer } from "../testing/server";

const secureItems = () => (jest.requireMock("expo-secure-store") as { __items: Map<string, string> }).__items;
const camera = () => (jest.requireMock("expo-camera") as { __permission: { granted: boolean } }).__permission;

async function typeConnection(url: string, token: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("サーバーのURL"), url);
  await user.type(screen.getByLabelText("トークン"), token);
  await user.press(screen.getByRole("button", { name: "接続する" }));
}

describe("connecting to a server", () => {
  it("shows the connection screen, and no articles, right after installing", async () => {
    const server = await makeServer();
    await server.article((await server.category()).id, { title: "A story" });
    await renderApp({ server, connected: false });

    expect(await screen.findByRole("button", { name: "QRコードを読み取る" })).toBeOnTheScreen();
    expect(screen.getByLabelText("サーバーのURL")).toBeOnTheScreen();
    expect(screen.getByLabelText("トークン")).toBeOnTheScreen();
    expect(screen.queryByText("A story")).toBeNull();
  });

  it("says nothing about the camera before the user has tried to scan", async () => {
    await renderApp({ connected: false });

    await screen.findByRole("button", { name: "QRコードを読み取る" });

    expect(screen.queryByText(/カメラの許可/)).toBeNull();
  });

  it("shows the unread list after the URL and the right token are typed", async () => {
    const server = await makeServer();
    await server.article((await server.category()).id, { title: "A story" });
    await renderApp({ server, connected: false });

    await typeConnection(server.url, server.token);

    expect(await screen.findByText("A story")).toBeOnTheScreen();
  });

  it("connects to a server whose URL starts with http", async () => {
    const server = await makeServer();
    expect(server.url.startsWith("http://")).toBe(true);
    await renderApp({ server, connected: false });

    await typeConnection(server.url, server.token);

    expect(await screen.findByRole("header", { name: "未読" })).toBeOnTheScreen();
  });

  it("stores nothing and says the token is wrong when it is", async () => {
    const server = await makeServer();
    await renderApp({ server, connected: false });

    await typeConnection(server.url, "not-the-token");

    expect(await screen.findByText(/トークンが正しくありません/)).toBeOnTheScreen();
    expect(secureItems().size).toBe(0);
    expect(await loadConnection()).toBeNull();
    expect(await lastUrl()).toBeNull();
  });

  it("stores nothing and says the server cannot be reached when it cannot", async () => {
    const server = await makeServer();
    await renderApp({ server, connected: false, offline: () => true });

    await typeConnection(server.url, server.token);

    expect(await screen.findByText(/サーバーに届きません/)).toBeOnTheScreen();
    expect(secureItems().size).toBe(0);
  });

  it("keeps the token in the encrypted storage only", async () => {
    const server = await makeServer();
    await renderApp({ server, connected: false });

    await typeConnection(server.url, server.token);
    await screen.findByRole("header", { name: "未読" });

    expect([...secureItems().values()]).toEqual([server.token]);
    const plain = await AsyncStorage.multiGet(await AsyncStorage.getAllKeys());
    expect(JSON.stringify(plain)).not.toContain(server.token);
  });

  it("does not ask again after the app is closed and opened", async () => {
    const server = await makeServer();
    await server.article((await server.category()).id, { title: "A story" });
    const first = await renderApp({ server, connected: false });
    await typeConnection(server.url, server.token);
    await screen.findByText("A story");
    await first.unmount();

    await renderApp({ server, connected: false });

    expect(await screen.findByText("A story")).toBeOnTheScreen();
    expect(screen.queryByLabelText("トークン")).toBeNull();
  });

  it("shows the connection screen and says so when the server no longer accepts the token", async () => {
    const server = await makeServer();
    await saveConnection({ url: server.url, token: "token-from-before" });

    await renderApp({ server, connected: false });

    expect(await screen.findByText(/トークンが無効になりました/)).toBeOnTheScreen();
    expect(screen.getByLabelText("トークン")).toBeOnTheScreen();
    expect(screen.getByLabelText("サーバーのURL").props.value).toBe(server.url);
  });
});

describe("connecting with a QR code", () => {
  async function scan(data: string) {
    const user = userEvent.setup();
    await user.press(await screen.findByRole("button", { name: "QRコードを読み取る" }));
    await fireEvent(await screen.findByTestId("camera"), "barcodeScanned", { data });
  }

  it("shows the unread list after the connection code of the web app is scanned", async () => {
    const server = await makeServer();
    await server.article((await server.category()).id, { title: "A story" });
    await renderApp({ server, connected: false });

    await scan(buildConnectLink(server.url, server.token));

    expect(await screen.findByText("A story")).toBeOnTheScreen();
  });

  it("stores nothing and says so when the code is not a connection code", async () => {
    const server = await makeServer();
    await renderApp({ server, connected: false });

    await scan("https://example.org/");

    expect(await screen.findByText(/接続用のQRコードではありません/)).toBeOnTheScreen();
    expect(secureItems().size).toBe(0);
  });

  it("leaves typing possible and explains the permission when the camera is refused", async () => {
    const server = await makeServer();
    camera().granted = false;
    await renderApp({ server, connected: false });
    const user = userEvent.setup();

    await user.press(await screen.findByRole("button", { name: "QRコードを読み取る" }));

    expect(await screen.findByText(/カメラの許可が必要です/)).toBeOnTheScreen();
    expect(screen.queryByTestId("camera")).toBeNull();
    await typeConnection(server.url, server.token);
    await waitFor(() => expect(screen.getByRole("header", { name: "未読" })).toBeOnTheScreen());
  });
});
