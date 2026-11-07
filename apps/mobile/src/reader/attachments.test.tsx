import { screen, userEvent, within } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import { renderApp } from "../testing/app";
import { makeServer, type TestServer } from "../testing/server";

const press = async (name: string | RegExp) => userEvent.setup().press(await screen.findByRole("button", { name }));
const PAGE = "https://video.example.org/watch/1";

/** The original address an image loads through the test server's relay, or null when it does not load from there. */
function relayedFrom(server: TestServer, uri: string): string | null {
  const prefix = `${server.url}/api/v1/image-proxy/`;
  if (!uri.startsWith(prefix)) return null;
  const [, encoded] = uri.slice(prefix.length).split("/");
  return Buffer.from(encoded!, "base64url").toString("utf8");
}

/** A feed article with the given attachments, stored as ingestion stores them, opened from the list. */
async function opened(stored: unknown[] | null) {
  const server = await makeServer();
  const feed = await server.feed("Video Feed", (await server.category("Tools")).id);
  const id = await server.feedArticle(feed.id, { title: "Video", body: "What the video shows.", url: PAGE });
  await server.sql("UPDATE articles SET attachments = ? WHERE id = ?", stored === null ? null : JSON.stringify(stored), id);
  await renderApp({ server });
  await press(/Video/);
  await screen.findByRole("header", { name: "Video" });
  return server;
}

describe("the attachments below the body", () => {
  beforeEach(() => (WebBrowser.openBrowserAsync as jest.Mock).mockClear());

  it("show an image through the relay, the thumbnail as a link to the article's page, and the other files as links with kind and size", async () => {
    const server = await opened([
      { url: "https://img.example.org/cover.jpg", kind: "image", mimeType: "image/jpeg", size: null, title: "表紙", thumbnail: false },
      { url: "http://img.example.org/thumb.jpg", kind: "image", mimeType: null, size: null, title: "動画の題", thumbnail: true },
      { url: "https://cdn.example.org/episode.mp3", kind: "audio", mimeType: "audio/mpeg", size: 2048, title: null, thumbnail: false },
    ]);
    const section = await screen.findByTestId("attachments");
    expect(within(section).getByRole("header", { name: "添付" })).toBeOnTheScreen();
    expect(relayedFrom(server, within(section).getByRole("image", { name: "表紙" }).props.source.uri)).toBe("https://img.example.org/cover.jpg");

    const thumbnail = within(section).getByRole("link", { name: "元のページを開く：動画の題" });
    expect(relayedFrom(server, within(thumbnail).getByRole("image").props.source.uri)).toBe("http://img.example.org/thumb.jpg");
    await userEvent.setup().press(thumbnail);
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith(PAGE);

    await userEvent.setup().press(within(section).getByRole("link", { name: "episode.mp3、音声、2 KB" }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith("https://cdn.example.org/episode.mp3");
  });

  it("are not there for an article without attachments", async () => {
    await opened(null);
    expect(screen.queryByTestId("attachments")).toBeNull();
  });
});
