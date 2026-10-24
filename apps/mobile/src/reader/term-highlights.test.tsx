import { act, screen, userEvent, waitFor, within } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import { colors } from "../theme/tokens";
import { renderApp } from "../testing/app";
import { makeServer, type TestServer } from "../testing/server";

const AT = "2026-03-01T11:00:00.000Z";
const press = async (name: string | RegExp) => userEvent.setup().press(await screen.findByRole("button", { name }));
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...[style].flat(5).filter(Boolean)) as Record<string, unknown>;

/** The text a node draws, nested texts included. */
interface Drawn {
  children: ReadonlyArray<Drawn | string>;
}
function textOf(node: Drawn | string): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}
/** The coloured places under a node, as `text:colour`. */
const colored = (node?: Parameters<typeof within>[0]) =>
  (node ? within(node) : screen)
    .queryAllByTestId(/^term-match-/)
    .map((match) => `${textOf(match as unknown as Drawn)}:${String(match.props.testID).slice("term-match-".length)}`);
const badges = (node: Parameters<typeof within>[0]) =>
  within(node)
    .queryAllByTestId(/^term-badge-/)
    .map((badge) => `${textOf(badge as unknown as Drawn)}:${String(badge.props.testID).slice("term-badge-".length)}`);

async function group(server: TestServer, name: string, color: string, ...terms: string[]) {
  const created = await server.core<{ id: number }>("createTermGroup", { name, color }, "$clock");
  for (const text of terms) await server.core("addHighlightTerm", created.id, { text }, "$clock");
  return created;
}

const row = async (title: RegExp) => screen.findByRole("button", { name: title });

describe("term highlights in the list", () => {
  it("colour the summary of a generated article and the translated title of a feed article", async () => {
    const server = await makeServer();
    await group(server, "規制", "green", "規制");
    await server.article((await server.category()).id, { title: "半導体の話", summary: "新しい規制案が出た" });
    const blog = await server.feed("Blog");
    const id = await server.feedArticle(blog.id, { title: "New rules", at: AT });
    await server.core("saveTranslatedTitle", id, { original: "New rules", title: "新しい規制", sourceLanguage: "en" });
    await renderApp({ server, url: "/list/all" });

    await waitFor(async () => expect(colored(await row(/^半導体の話/))).toEqual(["規制:green"]));
    expect(colored(screen.getByTestId(`title-${id}`))).toEqual(["規制:green"]);
  });

  it("show the badges of the groups a row matches, and read them out with the row; none for a row that matches only in its body", async () => {
    const server = await makeServer();
    await group(server, "半導体", "green", "半導体");
    await group(server, "通商", "orange", "関税");
    const category = (await server.category()).id;
    await server.article(category, { title: "関税の話", summary: "半導体の輸出" });
    await server.article(category, { title: "関係のない話", summary: "要約" });
    await server.article(category, { title: "本文だけの話", summary: "要約", body: "半導体の話" });
    await renderApp({ server, url: "/list/all" });

    await waitFor(async () => expect(badges(await row(/^関税の話/))).toEqual(["半導体:green", "通商:orange"]));
    expect((await row(/^関税の話/)).props.accessibilityLabel).toMatch(/。半導体。通商。未読$/);
    expect(badges(await row(/^関係のない話/))).toEqual([]);
    expect(badges(await row(/^本文だけの話/))).toEqual([]);
  });

  it("take the terms added on the web once the list is pulled to refresh", async () => {
    const server = await makeServer();
    const trade = await group(server, "通商", "orange");
    await server.article((await server.category()).id, { title: "関税の話", summary: "要約" });
    await renderApp({ server, url: "/list/all" });
    await row(/^関税の話/);
    expect(colored()).toEqual([]);

    await server.core("addHighlightTerm", trade.id, { text: "関税" }, "$clock");
    const { refreshControl } = screen.getByTestId("article-list").props as { refreshControl: { props: { onRefresh: () => void } } };
    await act(async () => refreshControl.props.onRefresh());

    await waitFor(async () => expect(colored(await row(/^関税の話/))).toEqual(["関税:orange"]));
  });

  it("use the values of the chosen colour scheme", async () => {
    const server = await makeServer();
    await group(server, "規制", "green", "規制");
    await server.article((await server.category()).id, { title: "規制の話", summary: "要約" });
    await renderApp({ server, url: "/settings" });
    await userEvent.setup().press(await screen.findByRole("radio", { name: "ダーク" }));
    await press("一覧へ戻る");

    await waitFor(() => expect(screen.getAllByTestId("term-match-green").length).toBeGreaterThan(0));
    const style = flat(screen.getAllByTestId("term-match-green")[0]!.props.style);
    expect(style.backgroundColor).toBe(colors.dark["term-green-fill"]);
    expect(style.textDecorationLine).toBe("underline");
  });
});

describe("term highlights in an article", () => {
  it("colour every place in the body of a generated article, and the headline, with a line under them", async () => {
    const server = await makeServer();
    await group(server, "規制", "pink", "規制");
    await server.article((await server.category()).id, { title: "規制の話", body: "最初の規制。\n\n次の段落にも規制がある。" });
    await renderApp({ server });
    await press(/^規制の話/);

    const headline = await screen.findByRole("header", { name: "規制の話" });
    await waitFor(() => expect(colored()).toEqual(["規制:pink", "規制:pink", "規制:pink"]));
    expect(colored(headline)).toEqual(["規制:pink"]);
    expect(flat(screen.getAllByTestId("term-match-pink")[1]!.props.style)).toMatchObject({ backgroundColor: colors.light["term-pink-fill"], textDecorationLine: "underline" });
  });

  it("colours delivered content as written, and a link that is coloured still opens", async () => {
    const server = await makeServer();
    await group(server, "A", "purple", "chip");
    const blog = await server.feed("Blog");
    await server.feedArticle(blog.id, { title: "Weekly", body: "A Chip maker. See [the chip report](https://example.org/report?campaign=chip).", at: AT });
    (WebBrowser.openBrowserAsync as jest.Mock).mockClear();
    await renderApp({ server, url: `/list/feed-${blog.id}` });
    await press(/^Weekly/);

    await waitFor(() => expect(colored()).toEqual(["Chip:purple", "chip:purple"]));
    const link = await screen.findByRole("link", { name: "the chip report" });
    await userEvent.setup().press(within(link).getByTestId("term-match-purple"));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://example.org/report?campaign=chip");
  });

  it("colours the translation that has the term and not the original under it", async () => {
    const server = await makeServer();
    await group(server, "規制", "green", "規制");
    const blog = await server.feed("Blog");
    await server.core("updateFeed", blog.id, { translate: true }, "$clock");
    const id = await server.feedArticle(blog.id, { title: "New rules", body: "New rules.", at: AT });
    await server.core("saveTranslatedTitle", id, { original: "New rules", title: "新しいルール", sourceLanguage: "en" });
    await server.core("saveArticleTranslation", id, { segments: [{ original: "New rules.", translated: "新しい規制。" }], method: "google", truncated: false, now: AT });
    await renderApp({ server, url: `/list/feed-${blog.id}` });
    await press(/^新しいルール/);

    await screen.findByText(/新しい規制/);
    await waitFor(() => expect(colored()).toEqual(["規制:green"]));
    expect(textOf(screen.getByText("New rules.") as unknown as Drawn)).toBe("New rules.");
  });

  it("colours the summary of a feed article", async () => {
    const server = await makeServer();
    await group(server, "規制", "orange", "規制");
    const blog = await server.feed("Blog");
    const id = await server.feedArticle(blog.id, { title: "Rules", body: "Text.", at: AT });
    await server.core("saveAutoSummary", id, { text: "新しい規制の話。", source: "page", now: AT });
    await renderApp({ server, url: `/list/feed-${blog.id}` });
    await press(/^Rules/);

    await screen.findByText("AIによる要約");
    await waitFor(() => expect(colored()).toEqual(["規制:orange"]));
  });
});
