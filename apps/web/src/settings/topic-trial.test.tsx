import { applyInterpretation, createRun, createTopic, getTopic, insertCandidate } from "@smarternews/core";
import { materialLines, type FakeHandler } from "@smarternews/core/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeServer, renderApp } from "../testing/harness.tsx";

const interpretation = { queries: ["rust 2.0", "rustc"], criteria: "Only compiler releases.", suggestedSources: { newsSearch: true, llmSearch: false } };

/** Accepts only the candidates whose title holds "release"; a minor one with importance 2. */
const judge: FakeHandler = (request) => ({
  judgments: materialLines<{ id: number; title: string }>(request.prompt).map((line) => ({
    id: line.id,
    relevant: line.title.includes("release"),
    reason: line.title.includes("release") ? "リリースの知らせ" : "リリースではない",
    importance: line.title.includes("minor") ? 2 : 4,
  })),
});

function seeded(options: Parameters<typeof makeServer>[1] = {}) {
  const server = makeServer("2026-03-20T00:00:00.000Z", { interpret: () => interpretation, judge, ...options });
  const category = server.category("Rust");
  const topic = applyInterpretation(server.db, createTopic(server.db, category.id, { text: "Rust news" }, server.clock).id, {
    queries: ["rust"],
    criteria: "Anything about Rust.",
    suggestedSources: { newsSearch: true, llmSearch: false },
  });
  const run = createRun(server.db, { categoryId: category.id, trigger: "manual", slot: null }, server.clock);
  const add = (status: "pending" | "rejected", title: string, reason: string) =>
    insertCandidate(server.db, {
      categoryId: category.id,
      runId: run.id,
      url: `https://example.org/${encodeURIComponent(title)}`,
      fetchable: true,
      title,
      snippet: "",
      siteName: "Example",
      publishedAt: "2026-03-19T00:00:00.000Z",
      sourceKind: "feed",
      status,
      reason,
      reasonCode: null,
      importance: 3,
      topicIds: [topic.id],
      now: "2026-03-19T00:00:00.000Z",
    });
  return { server, category, topic, add };
}

async function openEditor(s: ReturnType<typeof seeded>) {
  const view = renderApp({ server: s.server, route: `/settings/categories/${s.category.id}` });
  await view.user.click(await screen.findByRole("button", { name: "Rust news を編集" }));
  const text = screen.getByLabelText("トピックの文章");
  await view.user.clear(text);
  await view.user.type(text, "Rust compiler releases");
  return view;
}

describe("trying a topic before saving it", () => {
  it("tries the text being edited without saving it, and lists the candidates whose verdict turns", async () => {
    const s = seeded();
    s.add("pending", "Rust conference", "Rustの話題");
    s.add("rejected", "Rust minor release", "広告");
    s.add("rejected", "Rust blog", "関係ない");
    const { user, requests } = await openEditor(s);

    await user.click(screen.getByRole("button", { name: "試す" }));

    const results = await screen.findByRole("region", { name: "試しの結果" });
    await within(results).findByText("3件を試し、2件の結論が入れ替わりました。", {}, { timeout: 4000 });
    expect(results).toHaveTextContent("rust 2.0 / rustc");
    expect(results).toHaveTextContent("Only compiler releases.");
    const items = within(results).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const conference = items.find((item) => item.textContent?.includes("Rust conference"))!;
    expect(conference).toHaveTextContent("前採用Rustの話題");
    expect(conference).toHaveTextContent("試し除外リリースではない");
    const minor = items.find((item) => item.textContent?.includes("Rust minor release"))!;
    expect(minor).toHaveTextContent("前除外広告");
    expect(minor).toHaveTextContent("試し採用リリースの知らせ（重要度 2）");
    expect(minor).toHaveTextContent("重要度がカテゴリの最低（3）を下回るため、記事になりません");
    expect(within(minor).getByRole("link", { name: "Rust minor release" })).toHaveAttribute("href", "https://example.org/Rust%20minor%20release");

    expect(s.server.llmRequests.interpret[0]!.prompt).toContain("Rust compiler releases");
    expect(requests.filter((request) => request.startsWith("PATCH"))).toEqual([]);
    expect(getTopic(s.server.db, s.topic.id).text).toBe("Rust news");
    // The edit is still there, unsaved.
    expect(screen.getByLabelText("トピックの文章")).toHaveValue("Rust compiler releases");
  });

  it("says so when no verdict turns", async () => {
    const s = seeded();
    s.add("rejected", "Rust blog", "関係ない");
    const { user } = await openEditor(s);

    await user.click(screen.getByRole("button", { name: "試す" }));

    const results = await screen.findByRole("region", { name: "試しの結果" });
    await within(results).findByText("入れ替わる候補はありません。", {}, { timeout: 4000 });
    expect(results).toHaveTextContent("1件を試し、0件の結論が入れ替わりました。");
  });

  it("shows that the trial is running until its result comes", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const s = seeded({
      interpret: async () => {
        await gate;
        return interpretation;
      },
    });
    const { user } = await openEditor(s);

    await user.click(screen.getByRole("button", { name: "試す" }));

    const results = await screen.findByRole("region", { name: "試しの結果" });
    await within(results).findByText("試しています…");
    expect(screen.getByRole("button", { name: "試す" })).toBeDisabled();
    release();
    await within(results).findByText("入れ替わる候補はありません。", {}, { timeout: 4000 });
    expect(screen.getByRole("button", { name: "試す" })).toBeEnabled();
  });

  it("says why a trial was refused when its allowance is used up", async () => {
    const s = seeded({ topicTrialsPerDay: 0 });
    const { user } = await openEditor(s);

    await user.click(screen.getByRole("button", { name: "試す" }));

    const results = await screen.findByRole("region", { name: "試しの結果" });
    await waitFor(() => expect(results).toHaveTextContent("今日の試しの上限に達したため、試せません。"));
    expect(s.server.llmRequests.interpret).toHaveLength(0);
  });
});
