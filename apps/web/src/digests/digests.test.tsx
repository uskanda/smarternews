import { updateSettings } from "@smarternews/core";
import { materialLines, type FakeHandler } from "@smarternews/core/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";

/** A summary and one line for each listed category, drawn from every article of it, named after the clock. */
function answer(summary: string): FakeHandler {
  return (request) => {
    const categories = materialLines<{ id: number }>(request.prompt, 0);
    const articles = materialLines<{ id: number; categoryId: number | null }>(request.prompt, 1);
    return {
      executiveSummary: summary,
      sections: categories.map((category) => ({
        categoryId: category.id,
        lines: [{ text: `${summary} line`, articleIds: articles.filter((a) => a.categoryId === category.id).map((a) => a.id) }],
      })),
    };
  };
}

/** Answers with the summary the test sets before each digest. */
function scripted() {
  let summary = "";
  const handler: FakeHandler = (request) => answer(summary)(request);
  return { handler, say: (next: string) => (summary = next) };
}

async function build(server: TestServer) {
  expect(server.digests.buildNow()).toBe("queued");
  await server.digests.idle();
}

/** A morning digest on Security, and an evening one on Security and Tools. */
async function twoDigests() {
  const script = scripted();
  const server = makeServer("2026-03-01T06:00:00.000Z", { digest: script.handler });
  const security = server.category("Security");
  const tools = server.category("Tools");
  const morning = server.article(security.id, { title: "Morning story" });
  server.clock.set("2026-03-01T07:00:00.000Z");
  script.say("Morning summary");
  await build(server);
  server.clock.set("2026-03-01T18:00:00.000Z");
  const evening = server.article(security.id, { title: "Evening story" });
  const tool = server.article(tools.id, { title: "Tool story" });
  server.clock.set("2026-03-01T19:00:00.000Z");
  script.say("Evening summary");
  await build(server);
  return { server, security, tools, morning, evening, tool, script };
}

const page = () => screen.getByRole("region", { name: "ダイジェスト" });
const past = () => screen.getByRole("navigation", { name: "過去のダイジェスト" });

describe("the digests page", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the latest digest with its period, summary and sections, and lists every digest", async () => {
    const { server } = await twoDigests();
    renderApp({ server, route: "/digests" });

    expect(await within(await screen.findByRole("region", { name: "ダイジェスト" })).findByText("Evening summary")).toBeInTheDocument();
    const shown = page();
    expect(shown).toHaveTextContent("2026年3月1日 07:00");
    expect(shown).toHaveTextContent("2026年3月1日 19:00");
    const headings = within(shown).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["Security", "Tools"]);
    expect(within(past()).getAllByRole("link")).toHaveLength(2);
    expect(within(past()).getAllByRole("link")[0]).toHaveTextContent("19:00");
    expect(within(past()).getAllByRole("link")[1]).toHaveTextContent("07:00");
  });

  it("opens a past digest from the list, and opens it again after a reload", async () => {
    const { server } = await twoDigests();
    const first = renderApp({ server, route: "/digests" });
    await within(await screen.findByRole("region", { name: "ダイジェスト" })).findByText("Evening summary");

    await first.user.click(within(past()).getAllByRole("link")[1]!);

    expect(await within(page()).findByText("Morning summary")).toBeInTheDocument();
    expect(within(page()).getByText("Morning summary line")).toBeInTheDocument();
    const opened = first.path();
    expect(opened).toMatch(/^\/digests\/\d+$/);
    expect(within(past()).getAllByRole("link")[1]).toHaveAttribute("aria-current", "page");

    first.unmount();
    renderApp({ server, route: opened });
    expect(await within(await screen.findByRole("region", { name: "ダイジェスト" })).findByText("Morning summary")).toBeInTheDocument();
  });

  it("links each line to its source articles by title, and leaves out the deleted ones", async () => {
    const { server, evening, tool } = await twoDigests();
    server.db.prepare("DELETE FROM articles WHERE id = ?").run(tool);
    const { user, path } = renderApp({ server, route: "/digests" });
    await within(await screen.findByRole("region", { name: "ダイジェスト" })).findByText("Evening summary");

    expect(within(page()).queryByRole("link", { name: "Tool story" })).not.toBeInTheDocument();
    await user.click(within(page()).getByRole("link", { name: "Evening story" }));

    expect(path()).toBe(`/all/${evening}`);
    expect(await screen.findByRole("heading", { name: "Evening story" })).toBeInTheDocument();
  });

  it("says that there is no digest yet and when digests are made", async () => {
    const server = makeServer();
    updateSettings(server.db, { digestSchedule: ["07:00", "19:00"] });
    renderApp({ server, route: "/digests" });

    expect(await screen.findByText("ダイジェストはまだありません。")).toBeInTheDocument();
    expect(await screen.findByText(/07:00、19:00/)).toBeInTheDocument();
  });

  it("says that digests are made by hand only when there are no times", async () => {
    const server = makeServer();
    updateSettings(server.db, { digestSchedule: [] });
    renderApp({ server, route: "/digests" });

    expect(await screen.findByText("ダイジェストはまだありません。")).toBeInTheDocument();
    expect(await screen.findByText(/時刻では作りません/)).toBeInTheDocument();
  });

  it("makes a digest now, says so while it is made, and shows it when it is done", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const server = makeServer("2026-03-01T06:00:00.000Z", {
      digest: async (request) => {
        await gate;
        return answer("Fresh summary")(request);
      },
    });
    server.article(server.category("Security").id, { title: "Story" });
    const { user, requests } = renderApp({ server, route: "/digests" });
    await screen.findByText("ダイジェストはまだありません。");

    await user.click(screen.getByRole("button", { name: "今すぐ作る" }));

    expect(await screen.findByText(/作っています/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "今すぐ作る" })).toBeDisabled());
    expect(requests.filter((request) => request === "POST /api/v1/digests")).toHaveLength(1);

    release();
    await server.digests.idle();
    await vi.advanceTimersByTimeAsync(5_500);

    expect(await within(await screen.findByRole("region", { name: "ダイジェスト" })).findByText("Fresh summary")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "今すぐ作る" })).toBeEnabled());
    expect(screen.queryByText(/作っています/)).not.toBeInTheDocument();
  });

  it("says that the period holds no article", async () => {
    const server = makeServer("2026-03-01T06:00:00.000Z", { digest: answer("Never") });
    const { user } = renderApp({ server, route: "/digests" });
    await screen.findByText("ダイジェストはまだありません。");

    await user.click(screen.getByRole("button", { name: "今すぐ作る" }));

    expect(await screen.findByText(/期間内に記事がない/)).toBeInTheDocument();
    expect(server.llmRequests.digest).toHaveLength(0);
  });

  it("says that the day reached its limit", async () => {
    const server = makeServer("2026-03-01T06:00:00.000Z", { digest: answer("Never"), digestsPerDay: 0 });
    server.article(server.category().id);
    const { user } = renderApp({ server, route: "/digests" });
    await screen.findByText("ダイジェストはまだありません。");

    await user.click(screen.getByRole("button", { name: "今すぐ作る" }));

    expect(await screen.findByText(/1日の上限/)).toBeInTheDocument();
  });

  it("says that a digest is already being made when the server is making one", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const server = makeServer("2026-03-01T06:00:00.000Z", {
      digest: async (request) => {
        await gate;
        return answer("Other")(request);
      },
    });
    server.article(server.category().id);
    const { user } = renderApp({ server, route: "/digests" });
    await screen.findByText("ダイジェストはまだありません。");
    server.digests.buildNow();

    await user.click(screen.getByRole("button", { name: "今すぐ作る" }));

    expect(await screen.findByText(/すでに作っています/)).toBeInTheDocument();
    release();
    await server.digests.idle();
  });

  it("says that the digest asked for does not exist", async () => {
    const { server } = await twoDigests();
    renderApp({ server, route: "/digests/999" });

    expect(await screen.findByText("このダイジェストはありません。")).toBeInTheDocument();
    expect(await within(await screen.findByRole("navigation", { name: "過去のダイジェスト" })).findAllByRole("link")).toHaveLength(2);
  });
});
