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
    expect(cells.slice(4)).toEqual(["40", "32", "3", "1", "9", "—"]);
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

  const ALL_LIMIT = "新しい100件だけを表示しています。カテゴリで絞り込むと、それより古い実行が出ます。";
  const CATEGORY_LIMIT = "このカテゴリの新しい100件だけを表示しています。";

  it("says that only the newest 100 runs are shown when the list reaches 100", async () => {
    const server = makeServer();
    const category = server.category("Security");
    for (let i = 0; i < 100; i++) finished(server, category.id);
    renderApp({ server, route: "/runs" });

    expect(await screen.findByText(ALL_LIMIT)).toBeInTheDocument();
    expect(rows()).toHaveLength(100);
  });

  it("says nothing about the limit when the list has fewer than 100 runs", async () => {
    const server = makeServer();
    const category = server.category("Security");
    for (let i = 0; i < 99; i++) finished(server, category.id);
    renderApp({ server, route: "/runs" });

    await waitFor(() => expect(rows()).toHaveLength(99));
    expect(screen.queryByText(ALL_LIMIT)).not.toBeInTheDocument();
    expect(screen.queryByText(CATEGORY_LIMIT)).not.toBeInTheDocument();
  });

  it("does not suggest narrowing when the list is already narrowed to a category", async () => {
    const server = makeServer();
    const category = server.category("Security");
    for (let i = 0; i < 100; i++) finished(server, category.id);
    renderApp({ server, route: `/runs?category=${category.id}` });

    expect(await screen.findByText(CATEGORY_LIMIT)).toBeInTheDocument();
    expect(screen.queryByText(ALL_LIMIT)).not.toBeInTheDocument();
  });

  it("says that there are no runs yet", async () => {
    renderApp({ route: "/runs" });
    expect(await screen.findByText("実行の記録はまだありません。")).toBeInTheDocument();
  });
});

describe("attention", () => {
  const section = () => screen.getByRole("region", { name: "注意" });
  /** A scheduled run of the category that failed with its retries used up. */
  function failedSchedule(server: TestServer, categoryId: number, slot: string) {
    const id = finished(server, categoryId, { status: "failed", failures: [{ stage: "run", target: null, message: "boom" }] }, slot);
    setRetry(server.db, id, { skipped: "limit" });
    return id;
  }

  it("lists what to look at above the runs, with a link to the failed run", async () => {
    const server = makeServer();
    const category = server.category("Security");
    const run = failedSchedule(server, category.id, "2026-03-01T05:00");
    const { user, path } = renderApp({ server, route: "/runs" });

    expect(await screen.findByRole("region", { name: "注意" })).toHaveTextContent("Securityの定時の実行が失敗しました。やり直しの予定はありません。");
    await user.click(within(section()).getByRole("link", { name: "実行の詳細" }));

    expect(path()).toBe(`/runs/${run}`);
  });

  it("leads from a topic without articles to its editor", async () => {
    const server = makeServer();
    const category = server.category("Security");
    const topic = createTopic(server.db, category.id, { text: "Exploited bugs", interpretation: { queries: ["q"], criteria: "c" } }, server.clock);
    server.clock.advance(15 * 24 * 60 * MINUTE);
    const { user, path } = renderApp({ server, route: "/runs" });

    expect(await screen.findByRole("region", { name: "注意" })).toHaveTextContent("Securityのトピック「Exploited bugs」で、14日間、記事の作成も更新もありません。");
    const link = within(section()).getByRole("link", { name: "トピックの設定" });
    expect(link).toHaveAttribute("href", `/settings/categories/${category.id}#topic-${topic.id}`);
    await user.click(link);

    expect(path()).toBe(`/settings/categories/${category.id}`);
    expect(await screen.findByLabelText("トピックの文章")).toHaveValue("Exploited bugs");
  });

  it("is not shown when there is nothing to look at", async () => {
    const server = makeServer();
    finished(server, server.category("Security").id);
    renderApp({ server, route: "/runs" });

    await screen.findByRole("table", { name: "実行履歴" });
    expect(screen.queryByRole("region", { name: "注意" })).not.toBeInTheDocument();
  });

  it("drops an item that is dismissed, and lowers the count in the left pane", async () => {
    const server = makeServer();
    failedSchedule(server, server.category("Security").id, "2026-03-01T05:00");
    failedSchedule(server, server.category("Tools").id, "2026-03-01T05:00");
    const { user } = renderApp({ server, route: "/runs" });
    await screen.findByRole("region", { name: "注意" });
    expect(await screen.findByRole("link", { name: "実行履歴、注意2件" })).toBeInTheDocument();

    const [first] = within(section()).getAllByRole("listitem");
    await user.click(within(first!).getByRole("button", { name: "確認した" }));

    await waitFor(() => expect(within(section()).getAllByRole("listitem")).toHaveLength(1));
    expect(section()).not.toHaveTextContent("Securityの定時の実行");
    expect(screen.getByRole("link", { name: "実行履歴、注意1件" })).toBeInTheDocument();
    expect(server.db.prepare("SELECT COUNT(*) AS n FROM attention_dismissals").get()).toEqual({ n: 1 });
  });

  it("keeps an item and says so when the dismissal cannot be stored", async () => {
    const server = makeServer();
    failedSchedule(server, server.category("Security").id, "2026-03-01T05:00");
    let down = false;
    const { user } = renderApp({ server, route: "/runs", offline: () => down });
    await screen.findByRole("region", { name: "注意" });

    down = true;
    await user.click(within(section()).getByRole("button", { name: "確認した" }));

    expect(await screen.findByText("確認したことを保存できませんでした。もう一度試してください。")).toBeInTheDocument();
    expect(within(section()).getAllByRole("listitem")).toHaveLength(1);
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
        reasonCode: null,
        importance: 1,
        topicIds: [index < 8 ? flaws.id : ransom.id],
        now: server.clock().toISOString(),
      });
    }
    return { server, category, id, flaws, ransom };
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

  it("leads from the topic of each rejected candidate to the editor of that topic", async () => {
    const { server, category, id, flaws } = withRejections();
    const { user, path } = renderApp({ server, route: `/runs/${id}` });
    const rejected = await screen.findByRole("region", { name: "除外した候補" });
    const item = (await within(rejected).findByRole("link", { name: "Rejected 0" })).closest("li")!;

    const topic = within(item).getByRole("link", { name: "exploited flaws" });
    expect(topic).toHaveAttribute("href", `/settings/categories/${category.id}#topic-${flaws.id}`);

    await user.click(topic);

    expect(path()).toBe(`/settings/categories/${category.id}`);
    expect(await screen.findByLabelText("トピックの文章")).toHaveValue("exploited flaws");
  });

  it("groups the rejected candidates by topic and leads to the topic's editor", async () => {
    const { server, category, id, flaws, ransom } = withRejections();
    const { user } = renderApp({ server, route: `/runs/${id}` });
    const rejected = await screen.findByRole("region", { name: "除外した候補" });
    await within(rejected).findByRole("link", { name: "Rejected 0" });

    await user.click(within(rejected).getByRole("checkbox", { name: "トピックごとにまとめる" }));

    const groups = within(rejected).getAllByRole("group");
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual(["exploited flaws（8件）", "ransomware（3件）"]);
    expect(within(groups[0]!).getAllByRole("listitem")).toHaveLength(8);
    const fix = within(groups[0]!).getByRole("link", { name: "exploited flaws を直す" });
    expect(fix).toHaveTextContent("このトピックを直す");
    expect(fix).toHaveAttribute("href", `/settings/categories/${category.id}#topic-${flaws.id}`);
    expect(within(groups[1]!).getByRole("link", { name: "ransomware を直す" })).toHaveAttribute(
      "href",
      `/settings/categories/${category.id}#topic-${ransom.id}`,
    );
  });

  it("leads from each topic of the grouped candidates to the topic's row in the topic stats", async () => {
    const { server, category, id, flaws, ransom } = withRejections();
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    const { user, path } = renderApp({ server, route: `/runs/${id}` });
    const rejected = await screen.findByRole("region", { name: "除外した候補" });
    await within(rejected).findByRole("link", { name: "Rejected 0" });
    await user.click(within(rejected).getByRole("checkbox", { name: "トピックごとにまとめる" }));

    const groups = within(rejected).getAllByRole("group");
    const stats = within(groups[0]!).getByRole("link", { name: "exploited flaws の成績" });
    expect(stats).toHaveTextContent("このトピックの成績");
    expect(stats).toHaveAttribute("href", `/settings/categories/${category.id}#topic-stats-${flaws.id}`);
    expect(within(groups[1]!).getByRole("link", { name: "ransomware の成績" })).toHaveAttribute(
      "href",
      `/settings/categories/${category.id}#topic-stats-${ransom.id}`,
    );

    await user.click(stats);

    expect(path()).toBe(`/settings/categories/${category.id}`);
    const region = await screen.findByRole("region", { name: "トピックの成績" });
    await waitFor(() => expect(scroll.mock.contexts).toContain(region.querySelector(`#topic-stats-${flaws.id}`)));
    scroll.mockRestore();
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

/** Records model calls: task, cost (undefined for a provider that costs nothing, null for an unknown cost), run and time. */
function seedCalls(server: TestServer, calls: Array<[task: string, cost: number | null | undefined, runId: number | null, at?: string]>) {
  const insert = server.db.prepare(
    "INSERT INTO llm_calls (run_id, task, provider, duration_ms, ok, created_at, cost_usd, billable) VALUES (?, ?, 'p', 10, 1, ?, ?, ?)",
  );
  for (const [task, cost, runId, at] of calls) insert.run(runId, task, at ?? "2026-10-20T00:00:00.000Z", cost ?? null, cost === undefined ? 0 : 1);
}

describe("the money of runs", () => {
  it("shows the money of each run in the list, and a dash for a run that called no provider that costs money", async () => {
    const server = makeServer("2026-10-25T12:00:00.000Z");
    const category = server.category("Security");
    const free = finished(server, category.id, { llmCalls: 1 });
    const paid = finished(server, category.id, { llmCalls: 2 });
    seedCalls(server, [
      ["judge", undefined, free],
      ["judge", 0.1, paid],
      ["write", 0.3, paid],
    ]);
    renderApp({ server, route: "/runs" });

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByRole("columnheader", { name: "金額" })).toBeInTheDocument();
    expect(within(rows()[0]!).getAllByRole("cell").at(-1)).toHaveTextContent("$0.40");
    expect(within(rows()[1]!).getAllByRole("cell").at(-1)).toHaveTextContent("—");
  });

  it("shows the money of a run, its calls of unknown cost, and its calls and money by task", async () => {
    const server = makeServer("2026-10-25T12:00:00.000Z");
    const id = finished(server, server.category().id, { llmCalls: 5 });
    seedCalls(server, [
      ["judge", 0.04, id],
      ["judge", 0.06, id],
      ["judge", null, id],
      ["write", 0.3, id],
      ["translate", undefined, id],
    ]);
    renderApp({ server, route: `/runs/${id}` });

    const result = await screen.findByRole("region", { name: "結果" });
    await waitFor(() => expect(result).toHaveTextContent("金額$0.40"));
    expect(result).toHaveTextContent("金額のわからない呼び出し1件");
    const byTask = screen.getByRole("table", { name: "タスクごとの呼び出し" });
    expect(within(byTask).getByRole("row", { name: /判定/ })).toHaveTextContent(/判定\s*3\s*\$0\.10/);
    expect(within(byTask).getByRole("row", { name: /本文の生成/ })).toHaveTextContent(/本文の生成\s*1\s*\$0\.30/);
    expect(within(byTask).getByRole("row", { name: /翻訳/ })).toHaveTextContent(/翻訳\s*1\s*—/);
    expect(within(byTask).queryByRole("row", { name: /集約/ })).not.toBeInTheDocument();
  });

  it("shows a dash for the money of a run without calls to providers that cost money, and no table without calls", async () => {
    const server = makeServer();
    const id = finished(server, server.category().id);
    renderApp({ server, route: `/runs/${id}` });

    const result = await screen.findByRole("region", { name: "結果" });
    await waitFor(() => expect(result).toHaveTextContent("金額—"));
    expect(result).not.toHaveTextContent("金額のわからない呼び出し");
    expect(screen.queryByRole("table", { name: "タスクごとの呼び出し" })).not.toBeInTheDocument();
  });
});

describe("the usage section of the settings", () => {
  /** A server in the budget period from 10 October to 9 November, on 14 October at noon. */
  function usageServer(options: { billable?: boolean; budget?: number } = {}) {
    return makeServer("2026-10-14T12:00:00.000Z", {
      pricing: options.billable === false ? undefined : resolvePricing("claude-sonnet-5-5")!,
      budget: { monthlyBudgetUsd: options.budget ?? 100, warnRatio: 0.8, resetDay: 10 },
    });
  }

  /** Stores a generated article of the category, made on 12 October, and opened when `opened` is true. */
  function article(server: TestServer, categoryId: number, opened: boolean) {
    server.db
      .prepare(
        `INSERT INTO articles (category_id, origin, kind, title, summary, body, importance, first_published_at, updated_at, created_at, opened_at)
         VALUES (?, 'generated', 'news', 'T', 'S', 'B', 3, ?, ?, ?, ?)`,
      )
      .run(categoryId, "2026-10-12T00:00:00.000Z", "2026-10-12T00:00:00.000Z", "2026-10-12T00:00:00.000Z", opened ? "2026-10-13T00:00:00.000Z" : null);
  }

  it("comes right after the providers, and the links at the top lead to it", async () => {
    renderApp({ server: usageServer(), route: "/settings" });

    const usage = await screen.findByRole("region", { name: "利用量" });
    const regions = screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"));
    expect(regions[regions.indexOf("プロバイダー") + 1]).toBe("利用量");
    expect(within(screen.getByRole("navigation", { name: "設定の区画" })).getByRole("link", { name: "利用量" })).toHaveAttribute("href", "/settings#usage");
    expect(usage).toHaveAttribute("id", "usage");
    expect(await within(usage).findByText(/10月10日から今日まで（UTC）/)).toBeInTheDocument();
  });

  it("shows the money, the articles made and opened, and the money per opened article of each category, and the calls outside runs last", async () => {
    const server = usageServer();
    const category = server.category("Security");
    const run = finished(server, category.id, { llmCalls: 2 });
    seedCalls(server, [
      ["judge", 1.5, run, "2026-10-12T00:00:00.000Z"],
      ["write", 0.5, run, "2026-10-12T00:00:00.000Z"],
      ["summarize", 0.01, null, "2026-10-12T00:00:00.000Z"],
      ["summarize", 0.01, null, "2026-10-13T00:00:00.000Z"],
      ["translate", undefined, null, "2026-10-13T00:00:00.000Z"],
    ]);
    for (const opened of [true, true, false, false]) article(server, category.id, opened);
    const other = server.category("Tools");
    article(server, other.id, false);
    renderApp({ server, route: "/settings" });

    const usage = await screen.findByRole("region", { name: "利用量" });
    const table = await within(usage).findByRole("table", { name: "カテゴリごとの利用量" });
    const bodyRows = within(table).getAllByRole("row").slice(1);
    expect(bodyRows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual([
      ["2", "$2.00", "4", "2", "$1.00"],
      ["0", "$0.00", "1", "0", "—"],
      ["3", "$0.02", "", "", ""],
    ]);
    expect(within(bodyRows[0]!).getByRole("rowheader")).toHaveTextContent("Security");
    expect(within(bodyRows[2]!).getByRole("rowheader")).toHaveTextContent("実行に属さない呼び出し");
  });

  it("shows every UTC day of the period up to today with its money and calls, and a bar that is not read out", async () => {
    const server = usageServer();
    seedCalls(server, [
      ["summarize", 0.25, null, "2026-10-12T23:59:00.000Z"],
      ["summarize", 0.5, null, "2026-10-13T00:01:00.000Z"],
    ]);
    renderApp({ server, route: "/settings" });

    const usage = await screen.findByRole("region", { name: "利用量" });
    const table = await within(usage).findByRole("table", { name: "日ごとの利用量" });
    const bodyRows = within(table).getAllByRole("row").slice(1);
    expect(bodyRows.map((row) => row.textContent)).toEqual([
      "10月10日$0.000",
      "10月11日$0.000",
      "10月12日$0.251",
      "10月13日$0.501",
      "10月14日$0.000",
    ]);
    const bar = (index: number) => bodyRows[index]!.querySelector<HTMLElement>("[aria-hidden='true']");
    expect(bar(3)).toHaveStyle({ width: "100%" });
    expect(bar(2)).toHaveStyle({ width: "50%" });
  });

  it("projects the money at the end of the period, and says when it passes the budget", async () => {
    const server = usageServer({ budget: 10 });
    // 4.5 days of the 31 have passed.
    seedCalls(server, [["summarize", 4.5, null, "2026-10-12T00:00:00.000Z"]]);
    renderApp({ server, route: "/settings" });

    const usage = await screen.findByRole("region", { name: "利用量" });
    expect(await within(usage).findByText(/期末の11月9日までに\$31\.00になる見込みで、月の予算の\$10\.00を超えます/)).toBeInTheDocument();
  });

  it("does not say that a projection within the budget passes it", async () => {
    const server = usageServer();
    seedCalls(server, [["summarize", 4.5, null, "2026-10-12T00:00:00.000Z"]]);
    renderApp({ server, route: "/settings" });

    const usage = await screen.findByRole("region", { name: "利用量" });
    expect(await within(usage).findByText(/\$31\.00になる見込みです/)).toBeInTheDocument();
    expect(usage).not.toHaveTextContent("超えます");
  });

  it("says that the calls cost nothing, counts them, and projects nothing when no provider costs money", async () => {
    const server = usageServer({ billable: false });
    seedCalls(server, [["summarize", undefined, null, "2026-10-12T00:00:00.000Z"]]);
    renderApp({ server, route: "/settings" });

    const usage = await screen.findByRole("region", { name: "利用量" });
    const table = await within(usage).findByRole("table", { name: "カテゴリごとの利用量" });
    const outside = within(table).getByRole("row", { name: /実行に属さない呼び出し/ });
    expect(within(outside).getAllByRole("cell").map((cell) => cell.textContent).slice(0, 2)).toEqual(["1", "かからない"]);
    expect(usage).not.toHaveTextContent("見込み");
    const days = within(usage).getByRole("table", { name: "日ごとの利用量" });
    expect(within(days).getByRole("row", { name: /10月12日/ })).toHaveTextContent("かからない");
  });
});
