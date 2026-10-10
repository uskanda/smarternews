import { createRun, createTopic, finishRun, insertCandidate, startRun, type RunOutcome } from "@smarternews/core";
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";

const MINUTE = 60_000;

function finished(server: TestServer, categoryId: number, outcome: Partial<RunOutcome> = {}, slot: string | null = null) {
  const run = createRun(server.db, { categoryId, trigger: slot ? "schedule" : "manual", slot }, server.clock);
  startRun(server.db, run.id, server.clock().toISOString());
  finishRun(server.db, run.id, {
    status: "succeeded",
    finishedAt: server.clock().toISOString(),
    collected: 0,
    rejected: 0,
    articlesCreated: 0,
    articlesUpdated: 0,
    llmCalls: 0,
    failures: [],
    ...outcome,
  });
  server.clock.advance(MINUTE);
  return run.id;
}

const rows = () => within(screen.getByRole("table", { name: "実行履歴" })).getAllByRole("row").slice(1);

describe("running a category now", () => {
  it("starts a run, says that it is running, and does not let it be started twice", async () => {
    const server = makeServer();
    const category = server.category("Security");
    const { user, requests } = renderApp({ server, route: `/settings/categories/${category.id}` });

    await user.click(await screen.findByRole("button", { name: "いますぐ実行" }));

    expect(await screen.findByText(/実行中です/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "いますぐ実行" })).toBeDisabled());
    expect(requests.filter((request) => request === `POST /api/v1/categories/${category.id}/runs`)).toHaveLength(1);
  });
});

describe("the run history", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists runs newest first with category, trigger, time, state and counts", async () => {
    const server = makeServer("2026-03-01T05:00:00.000Z");
    const a = server.category("Security");
    const b = server.category("Tools");
    finished(server, a.id, { collected: 40, rejected: 32, articlesCreated: 3, articlesUpdated: 1, llmCalls: 9 }, "2026-03-01T05:00");
    finished(server, b.id, {}, "2026-03-01T05:00");
    finished(server, a.id, {});
    renderApp({ server, route: "/runs" });

    await screen.findByRole("table", { name: "実行履歴" });
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rows().map((row) => within(row).getAllByRole("cell")[0]!.textContent)).toEqual(["Security", "Tools", "Security"]);
    expect(rows()[0]).toHaveTextContent("手動");
    expect(rows()[2]).toHaveTextContent("スケジュール");
    expect(rows()[2]).toHaveTextContent("05:00");
    expect(rows()[2]).toHaveTextContent("成功");
    const cells = within(rows()[2]!).getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells.slice(4)).toEqual(["40", "32", "3", "1", "9"]);
  });

  it("narrows the list to one category", async () => {
    const server = makeServer();
    const a = server.category("Security");
    const b = server.category("Tools");
    finished(server, a.id);
    finished(server, b.id);
    const { user } = renderApp({ server, route: "/runs" });
    await waitFor(() => expect(rows()).toHaveLength(2));

    await user.selectOptions(screen.getByLabelText("カテゴリ"), "Tools");

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toHaveTextContent("Tools");
  });

  it("says each state in words", async () => {
    const server = makeServer();
    const category = server.category("Security");
    finished(server, category.id, { status: "partial" });
    finished(server, category.id, { status: "failed" });
    finished(server, category.id, { status: "stopped_by_limit" });
    createRun(server.db, { categoryId: category.id, trigger: "manual", slot: null }, server.clock);
    renderApp({ server, route: "/runs" });

    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(rows().map((row) => within(row).getAllByRole("cell")[3]!.textContent)).toEqual(["待機中", "上限で停止", "失敗", "一部失敗"]);
  });

  it("shows the result of a run when it ends, without a reload", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = makeServer();
    const category = server.category("Security");
    const run = createRun(server.db, { categoryId: category.id, trigger: "manual", slot: null }, server.clock);
    startRun(server.db, run.id, server.clock().toISOString());
    renderApp({ server, route: "/runs" });
    await waitFor(() => expect(rows()[0]).toHaveTextContent("実行中"));

    finishRun(server.db, run.id, {
      status: "succeeded",
      finishedAt: server.clock().toISOString(),
      collected: 12,
      rejected: 9,
      articlesCreated: 3,
      articlesUpdated: 0,
      llmCalls: 5,
      failures: [],
    });
    await vi.advanceTimersByTimeAsync(3500);

    await waitFor(() => expect(rows()[0]).toHaveTextContent("成功"));
    expect(within(rows()[0]!).getAllByRole("cell")[6]).toHaveTextContent("3");
  });

  it("says that there are no runs yet", async () => {
    renderApp({ route: "/runs" });
    expect(await screen.findByText("実行の記録はまだありません。")).toBeInTheDocument();
  });
});

describe("one run", () => {
  it("names the step that failed, what it was working on, and why", async () => {
    const server = makeServer();
    const category = server.category("Security");
    const id = finished(server, category.id, {
      status: "partial",
      failures: [{ stage: "feed", target: "https://example.org/down.xml", message: "HTTP status 500" }],
    });
    renderApp({ server, route: `/runs/${id}` });

    const failures = await screen.findByRole("region", { name: "失敗" });
    expect(failures).toHaveTextContent("フィード");
    expect(failures).toHaveTextContent("https://example.org/down.xml");
    expect(failures).toHaveTextContent("HTTP status 500");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Security");
    expect(screen.getByText("一部失敗")).toBeInTheDocument();
  });

  it("explains a run that stopped at the limit of model calls", async () => {
    const server = makeServer();
    const id = finished(server, server.category().id, { status: "stopped_by_limit", articlesCreated: 1, llmCalls: 40 });
    renderApp({ server, route: `/runs/${id}` });

    expect(await screen.findByText(/LLMの呼び出し回数の上限に達したため/)).toBeInTheDocument();
    expect(screen.getByText(/完成した記事は保存済み/)).toBeInTheDocument();
  });

  function withRejections() {
    const server = makeServer();
    const category = server.category("Security");
    const flaws = createTopic(server.db, category.id, { text: "exploited flaws" }, server.clock);
    const ransom = createTopic(server.db, category.id, { text: "ransomware" }, server.clock);
    const id = finished(server, category.id, { collected: 12, rejected: 11 });
    for (let index = 0; index < 11; index += 1) {
      insertCandidate(server.db, {
        categoryId: category.id,
        runId: id,
        url: `https://example.org/item-${index}`,
        fetchable: true,
        title: `Rejected ${index}`,
        snippet: "",
        siteName: "Example News",
        publishedAt: null,
        sourceKind: "feed",
        status: "rejected",
        reason: index < 8 ? "advertising without new information" : "about another product",
        importance: 1,
        topicIds: [index < 8 ? flaws.id : ransom.id],
        now: server.clock().toISOString(),
      });
    }
    return { server, category, id };
  }

  it("lists the rejected candidates with headline, site, topic and reason, and links to the pages", async () => {
    const { server, id } = withRejections();
    renderApp({ server, route: `/runs/${id}` });

    const rejected = await screen.findByRole("region", { name: "除外した候補" });
    await waitFor(() => expect(within(rejected).getAllByRole("listitem")).toHaveLength(11));
    const first = within(rejected).getByRole("link", { name: "Rejected 0" });
    expect(first).toHaveAttribute("href", "https://example.org/item-0");
    expect(first).toHaveAttribute("target", "_blank");
    const item = first.closest("li")!;
    expect(item).toHaveTextContent("Example News");
    expect(item).toHaveTextContent("exploited flaws");
    expect(item).toHaveTextContent("advertising without new information");
  });

  it("groups the rejected candidates by topic and leads to the topic's settings", async () => {
    const { server, category, id } = withRejections();
    const { user } = renderApp({ server, route: `/runs/${id}` });
    const rejected = await screen.findByRole("region", { name: "除外した候補" });
    await within(rejected).findByRole("link", { name: "Rejected 0" });

    await user.click(within(rejected).getByRole("checkbox", { name: "トピックごとにまとめる" }));

    const groups = within(rejected).getAllByRole("group");
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual(["exploited flaws（8件）", "ransomware（3件）"]);
    expect(within(groups[0]!).getAllByRole("listitem")).toHaveLength(8);
    expect(within(groups[0]!).getByRole("link", { name: "このトピックを直す" })).toHaveAttribute("href", `/settings/categories/${category.id}`);
  });

  it("says that a run does not exist", async () => {
    renderApp({ route: "/runs/4242" });
    expect(await screen.findByText("この実行の記録はありません。30日を過ぎて削除された可能性があります。")).toBeInTheDocument();
  });
});

describe("providers", () => {
  it("shows which provider runs each task and says where to change it", async () => {
    renderApp({ route: "/settings" });

    const providers = await screen.findByRole("region", { name: "プロバイダー" });
    await within(providers).findByText("本文の生成");
    for (const task of ["解釈", "検索", "判定", "集約", "本文の生成"]) expect(within(providers).getByText(task)).toBeInTheDocument();
    expect(providers).toHaveTextContent("config.yaml");
  });

  it("shows today's model calls next to the daily limit", async () => {
    const server = makeServer();
    const insert = server.db.prepare(
      "INSERT INTO llm_calls (task, provider, duration_ms, ok, created_at) VALUES ('judge', 'judge', 10, 1, ?)",
    );
    for (let index = 0; index < 280; index += 1) insert.run(server.clock().toISOString());
    renderApp({ server, route: "/settings" });

    const providers = await screen.findByRole("region", { name: "プロバイダー" });
    await waitFor(() => expect(providers).toHaveTextContent("280 / 300"));
  });
});
