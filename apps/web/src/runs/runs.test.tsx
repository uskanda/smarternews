import { createRun, createTopic, finishRun, insertCandidate, resolvePricing, setRetry, startRun, type RetrySkipped, type RunOutcome } from "@smarternews/core";
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
    const id = finished(server, server.category().id, { status: "stopped_by_limit", stoppedBy: "run", articlesCreated: 1, llmCalls: 40 });
    renderApp({ server, route: `/runs/${id}` });

    expect(await screen.findByText(/1回の実行のLLMの呼び出し回数が上限に達したため/)).toBeInTheDocument();
    expect(screen.getByText(/完成した記事は保存済み/)).toBeInTheDocument();
  });

  it("explains a run stopped at a limit before the server kept which one, as it did then", async () => {
    const server = makeServer();
    const id = finished(server, server.category().id, { status: "stopped_by_limit", articlesCreated: 1, llmCalls: 40 });
    renderApp({ server, route: `/runs/${id}` });

    expect(await screen.findByText(/^LLMの呼び出し回数が上限に達したため/)).toHaveTextContent("完成した記事は保存済み");
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

describe("retries", () => {
  /** A failed run of the schedule or of a retry, at the server's time. A minute passes after it. */
  function failedRun(
    server: TestServer,
    categoryId: number,
    options: { retry?: { attempt: number; of: number }; manual?: boolean; plan?: { at: string } | { skipped: RetrySkipped } } = {},
  ) {
    const run = createRun(
      server.db,
      { categoryId, trigger: options.manual ? "manual" : "schedule", slot: options.manual || options.retry ? null : "2026-03-01T05:00", retry: options.retry },
      server.clock,
    );
    startRun(server.db, run.id, server.clock().toISOString());
    finishRun(server.db, run.id, {
      status: "failed",
      finishedAt: server.clock().toISOString(),
      collected: 0,
      rejected: 0,
      articlesCreated: 0,
      articlesUpdated: 0,
      llmCalls: 0,
      failures: [{ stage: "feed", target: "https://example.org/down.xml", message: "HTTP status 500" }],
    });
    if (options.plan) setRetry(server.db, run.id, options.plan);
    server.clock.advance(MINUTE);
    return run.id;
  }

  it("marks a retry in the list with which retry it is, and leaves the other rows unmarked", async () => {
    const server = makeServer("2026-03-01T05:00:00.000Z");
    const category = server.category("Security");
    const first = failedRun(server, category.id);
    failedRun(server, category.id, { retry: { attempt: 1, of: first } });
    renderApp({ server, route: "/runs" });

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(within(rows()[0]!).getAllByRole("cell")[1]).toHaveTextContent("スケジュール1回目のやり直し");
    expect(within(rows()[1]!).getAllByRole("cell")[1]!.textContent).toBe("スケジュール");
  });

  it("says in the detail which retry the run is, and leads to the run it retries", async () => {
    const server = makeServer("2026-03-01T05:00:00.000Z");
    const category = server.category("Security");
    const first = failedRun(server, category.id);
    const second = failedRun(server, category.id, { retry: { attempt: 2, of: first } });
    const { user, path } = renderApp({ server, route: `/runs/${second}` });

    const result = await screen.findByRole("region", { name: "結果" });
    expect(within(result).getByText("2回目のやり直し")).toBeInTheDocument();
    await user.click(within(result).getByRole("link", { name: "元の実行" }));

    await waitFor(() => expect(path()).toBe(`/runs/${first}`));
    const original = await screen.findByRole("region", { name: "結果" });
    await waitFor(() => expect(original).toHaveTextContent("2026年3月1日 05:00"));
    expect(within(original).queryByText(/回目のやり直し/)).toBeNull();
    expect(within(original).queryByRole("link", { name: "元の実行" })).toBeNull();
  });

  it("shows when a failed run is retried", async () => {
    const server = makeServer("2026-03-01T05:00:00.000Z");
    const id = failedRun(server, server.category().id, { plan: { at: "2026-03-01T05:13:00.000Z" } });
    renderApp({ server, route: `/runs/${id}` });

    const result = await screen.findByRole("region", { name: "結果" });
    expect(within(result).getByText("やり直しの予定").nextElementSibling).toHaveTextContent("2026年3月1日 05:13");
  });

  it.each([
    { skipped: "limit", manual: false, says: "やり直しの上限に達しました。次の実行は、次のスケジュールの時刻です。" },
    { skipped: "superseded", manual: false, says: "次のスケジュールの実行が先に始まったため、やり直しません。" },
    { skipped: "disabled", manual: false, says: "カテゴリが無効か、有効なトピックがないため、やり直しません。" },
    { skipped: "manual", manual: true, says: "手動の実行は、自動ではやり直しません。" },
  ] as const)("says why a failed run is not retried: $skipped", async ({ skipped, manual, says }) => {
    const server = makeServer("2026-03-01T05:00:00.000Z");
    const id = failedRun(server, server.category().id, { manual, plan: { skipped } });
    renderApp({ server, route: `/runs/${id}` });

    const result = await screen.findByRole("region", { name: "結果" });
    expect(within(result).getByText(says)).toBeInTheDocument();
    expect(within(result).queryByText("やり直しの予定")).toBeNull();
  });

  it("says nothing about retries for a run that did not fail, and for a failed run from before retries existed", async () => {
    const server = makeServer("2026-03-01T05:00:00.000Z");
    const category = server.category();
    const succeeded = finished(server, category.id, {}, "2026-03-01T05:00");
    const old = failedRun(server, category.id, { manual: true });
    const view = renderApp({ server, route: `/runs/${succeeded}` });
    expect(await screen.findByRole("region", { name: "結果" })).not.toHaveTextContent("やり直");
    view.unmount();

    renderApp({ server, route: `/runs/${old}` });
    const result = await screen.findByRole("region", { name: "結果" });
    expect(result).toHaveTextContent("失敗");
    expect(result).not.toHaveTextContent("やり直");
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

describe("the monthly budget", () => {
  /** A server whose providers cost money, in the budget period from 10 October to 9 November. */
  function billed(spent: Array<[task: string, provider: string, cost: number | null]>) {
    const server = makeServer("2026-10-25T12:00:00.000Z", {
      pricing: resolvePricing("claude-sonnet-5-5")!,
      budget: { monthlyBudgetUsd: 100, warnRatio: 0.8, resetDay: 10 },
    });
    const insert = server.db.prepare(
      "INSERT INTO llm_calls (task, provider, duration_ms, ok, created_at, cost_usd, billable) VALUES (?, ?, 10, 1, '2026-10-20T00:00:00.000Z', ?, 1)",
    );
    for (const [task, provider, cost] of spent) insert.run(task, provider, cost);
    return server;
  }

  it("shows the budget period, what it spent of the budget, and the money by task and by provider", async () => {
    const server = billed([
      ["judge", "judge", 1.2],
      ["write", "write", 3.4],
      ["interpret", "interpret", 7.74],
    ]);
    renderApp({ server, route: "/settings" });

    const providers = await screen.findByRole("region", { name: "プロバイダー" });
    const budget = await within(providers).findByRole("group", { name: "月の予算" });
    expect(budget).toHaveTextContent("10月10日から11月9日まで");
    expect(budget).toHaveTextContent("$12.34 / $100.00");
    const byTask = within(providers).getByRole("table", { name: "タスクの割り当てと金額" });
    expect(within(byTask).getByRole("row", { name: /判定/ })).toHaveTextContent("$1.20");
    expect(within(byTask).getByRole("row", { name: /本文の生成/ })).toHaveTextContent("$3.40");
    expect(within(byTask).getByRole("row", { name: /要約/ })).toHaveTextContent("$0.00");
    const table = within(providers).getByRole("table", { name: "プロバイダーの一覧" });
    expect(within(table).getByRole("row", { name: /^judge/ })).toHaveTextContent("$1.20");
    expect(within(table).getByRole("row", { name: /^write/ })).toHaveTextContent("$3.40");
    expect(within(providers).queryByText(/金額のわからない呼び出し/)).not.toBeInTheDocument();
    expect(within(providers).queryByRole("status", { name: "予算の警告" })).not.toBeInTheDocument();
  });

  it("warns in words and numbers once the period spent the warning share of the budget", async () => {
    renderApp({ server: billed([["write", "write", 85]]), route: "/settings" });

    const providers = await screen.findByRole("region", { name: "プロバイダー" });
    const warning = await within(providers).findByRole("status", { name: "予算の警告" });
    expect(warning).toHaveTextContent("月の予算の85%を使いました");
  });

  it("says that the providers that cost money are not called until the next period once the budget is reached", async () => {
    renderApp({ server: billed([["write", "write", 100.04]]), route: "/settings" });

    const providers = await screen.findByRole("region", { name: "プロバイダー" });
    const warning = await within(providers).findByRole("status", { name: "予算の警告" });
    expect(warning).toHaveTextContent("月の予算に達しました");
    expect(warning).toHaveTextContent("11月10日まで、金額のかかるプロバイダーを呼び出しません");
  });

  it("says how many calls have an unknown cost, and that the total may be short by them", async () => {
    renderApp({ server: billed([["judge", "judge", null], ["judge", "judge", null]]), route: "/settings" });

    const providers = await screen.findByRole("region", { name: "プロバイダー" });
    expect(await within(providers).findByText(/金額のわからない呼び出しが2件/)).toHaveTextContent("合計は実際より少ない");
  });

  it("explains a run stopped by the monthly budget, with the day the next period starts", async () => {
    const server = billed([["write", "write", 100]]);
    const id = finished(server, server.category().id, { status: "stopped_by_limit", stoppedBy: "budget", articlesCreated: 1 });
    renderApp({ server, route: `/runs/${id}` });

    expect(await screen.findByText(/月の予算に達したため、途中で止まりました/)).toHaveTextContent("11月10日");
    expect(screen.getByText(/月の予算に達したため/)).toHaveTextContent("完成した記事は保存済み");
  });
});
