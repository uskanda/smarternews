import { screen, userEvent, within } from "@testing-library/react-native";
import { renderApp } from "../testing/app";
import { MINUTE } from "../testing/queries";
import { makeServer } from "../testing/server";

const NOTE = "元のページを読めなかったため、配信された内容だけをもとにしています。";
const WAITING = "AIによる要約を作っています。";
const press = async (name: string | RegExp) => userEvent.setup().press(await screen.findByRole("button", { name }));
/** Where a text stands among the texts of the screen, in the order they are drawn, to compare what comes first. */
const position = (text: string) =>
  screen
    .getAllByText(/./)
    .map((element) => [element.props.children].flat().join(""))
    .indexOf(text);

/** A feed with one article, so that the pager draws no neighbour beside it. */
async function oneArticle() {
  const server = await makeServer();
  const blog = await server.feed("Blog");
  return { server, blog };
}

describe("the summary of a feed article", () => {
  it("stands under a heading before the content, after the way to the page", async () => {
    const { server, blog } = await oneArticle();
    const id = await server.feedArticle(blog.id, { title: "New post", body: "New words.", at: "2026-03-01T11:00:00.000Z" });
    await server.core("saveAutoSummary", id, { text: "The post in three lines.", source: "page", now: "2026-03-01T11:30:00.000Z" });
    await renderApp({ server, url: `/list/feed-${blog.id}` });
    await press(/^New post/);

    const heading = await screen.findByRole("header", { name: "AIによる要約" });
    const summary = screen.getByTestId("auto-summary");
    expect(within(summary).getByText("The post in three lines.")).toBeOnTheScreen();
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(heading).toBeOnTheScreen();
    expect(position("元のページを開く")).toBeGreaterThanOrEqual(0);
    expect(position("元のページを開く")).toBeLessThan(position("AIによる要約"));
    expect(position("AIによる要約")).toBeLessThan(position("New words."));
  });

  it("is not there for an article without one", async () => {
    const { server, blog } = await oneArticle();
    await server.feedArticle(blog.id, { title: "New post", body: "New words.", at: "2026-03-01T11:00:00.000Z" });
    await renderApp({ server, url: `/list/feed-${blog.id}` });
    await press(/^New post/);

    expect(await screen.findByText("New words.")).toBeOnTheScreen();
    expect(screen.queryByTestId("auto-summary")).toBeNull();
    expect(screen.queryByRole("header", { name: "AIによる要約" })).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
  });

  it("says that the page could not be read when it was written from what the feed delivered", async () => {
    const { server, blog } = await oneArticle();
    const id = await server.feedArticle(blog.id, { title: "New post", body: "New words.", at: "2026-03-01T11:00:00.000Z" });
    await server.core("saveAutoSummary", id, { text: "Only the excerpt.", source: "feed", now: "2026-03-01T11:30:00.000Z" });
    await renderApp({ server, url: `/list/feed-${blog.id}` });
    await press(/^New post/);

    expect(within(await screen.findByTestId("auto-summary")).getByText(NOTE)).toBeOnTheScreen();
  });

  it("shows markup in it as the characters they are", async () => {
    const { server, blog } = await oneArticle();
    const id = await server.feedArticle(blog.id, { title: "New post", body: "New words.", at: "2026-03-01T11:00:00.000Z" });
    const text = "Before <script>alert(1)</script> ![alt](https://img.example.org/y.png) after";
    await server.core("saveAutoSummary", id, { text, source: "page", now: "2026-03-01T11:30:00.000Z" });
    await renderApp({ server, url: `/list/feed-${blog.id}` });
    await press(/^New post/);

    expect(within(await screen.findByTestId("auto-summary")).getByText(text)).toBeOnTheScreen();
    expect(screen.queryByRole("image")).toBeNull();
  });

  it("says before the content that the summary is being made while the article waits for it", async () => {
    const { server, blog } = await oneArticle();
    await server.advance(MINUTE);
    await server.core("updateFeed", blog.id, { autoSummarize: true }, "$clock");
    await server.advance(MINUTE);
    await server.feedArticle(blog.id, { title: "Fresh post", body: "Fresh words.", at: server.now().toISOString() });
    await renderApp({ server, url: `/list/feed-${blog.id}` });
    await press(/^Fresh post/);

    expect(await screen.findByText(WAITING)).toBeOnTheScreen();
    expect(position(WAITING)).toBeGreaterThanOrEqual(0);
    expect(position(WAITING)).toBeLessThan(position("Fresh words."));
    expect(screen.queryByTestId("auto-summary")).toBeNull();
  });
});
