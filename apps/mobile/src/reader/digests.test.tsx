import { screen, userEvent, within } from "@testing-library/react-native";
import { renderApp } from "../testing/app";
import { MINUTE } from "../testing/queries";
import { makeServer, type TestServer } from "../testing/server";

const HOUR = 60 * MINUTE;
const press = async (name: string | RegExp) => userEvent.setup().press(await screen.findByRole("button", { name }));

async function openDigestsFromDrawer() {
  await press("項目を開く");
  await press("ダイジェスト");
  await screen.findByRole("header", { name: "ダイジェスト" });
}

/** A digest at 07:00 and one at 19:00 on the server's day, the later one with a section on Security. */
async function twoDigests() {
  const server = await makeServer("2026-03-01T07:00:00.000Z");
  const security = await server.category("Security");
  const patched = await server.article(security.id, { title: "Patch released" });
  const deleted = await server.article(security.id, { title: "Gone" });
  const morning = await server.digest({ executiveSummary: "Morning overview." });
  await server.advance(12 * HOUR);
  const evening = await server.digest({
    executiveSummary: "Evening overview.",
    sections: [{ categoryId: security.id, categoryName: "Security", lines: [{ text: "A patch shipped.", articleIds: [patched, deleted] }] }],
  });
  await server.sql("DELETE FROM articles WHERE id = ?", deleted);
  return { server, morning, evening, patched };
}

async function pastList() {
  return within(await screen.findByTestId("digest-history"));
}

describe("the digests screen", () => {
  it("shows the latest digest from the drawer, with the past ones listed", async () => {
    const { server } = await twoDigests();
    await renderApp({ server });

    await openDigestsFromDrawer();

    expect(await screen.findByText("Evening overview.")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Security" })).toBeOnTheScreen();
    expect(screen.getByText("A patch shipped.")).toBeOnTheScreen();
    expect(screen.queryByText("Morning overview.")).toBeNull();
    const past = await pastList();
    expect(past.getAllByRole("button")).toHaveLength(2);
  });

  it("shows the period before the executive summary", async () => {
    const { server } = await twoDigests();
    await renderApp({ server, url: "/digests" });

    expect(await screen.findByText("2026年3月1日 13:00 〜 19:00")).toBeOnTheScreen();
  });

  it("switches to a past digest that is pressed", async () => {
    const { server } = await twoDigests();
    await renderApp({ server, url: "/digests" });
    await screen.findByText("Evening overview.");

    await userEvent.setup().press((await pastList()).getByRole("button", { name: /7:00/ }));

    expect(await screen.findByText("Morning overview.")).toBeOnTheScreen();
    expect(screen.queryByText("Evening overview.")).toBeNull();
  });

  it("opens the digest it is given", async () => {
    const { server, morning } = await twoDigests();
    await renderApp({ server, url: `/digests?digestId=${morning}` });

    expect(await screen.findByText("Morning overview.")).toBeOnTheScreen();
  });

  it("lists the source articles still stored under a line, and opens one that is pressed", async () => {
    const { server } = await twoDigests();
    await renderApp({ server, url: "/digests" });
    await screen.findByText("Evening overview.");

    expect(screen.queryByText("Gone")).toBeNull();
    await press("Patch released");

    expect(await screen.findByRole("header", { name: "Patch released" })).toBeOnTheScreen();
  });

  it("says there is no digest yet when there is none", async () => {
    const server: TestServer = await makeServer();
    await renderApp({ server });

    await openDigestsFromDrawer();

    expect(await screen.findByText("ダイジェストはまだありません。")).toBeOnTheScreen();
  });
});
