import { applyInterpretation, createTopic, getTopic, resolvePricing } from "@smarternews/core";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeServer, renderApp } from "../testing/harness.tsx";

const answer = {
  proposals: [
    { text: "Rustのコンパイラーのリリース。入門記事は除く", explanation: "入門記事を除くと書き足しました。判定基準でも入門記事が除かれるはずです。" },
    { text: "Rustのコンパイラーとツールのリリース", explanation: "ツールのリリースも含めました。" },
  ],
};

function seeded(options: Parameters<typeof makeServer>[1] = {}, interpreted = true) {
  const server = makeServer("2026-03-20T00:00:00.000Z", { proposeTopicRewrite: () => answer, ...options });
  const category = server.category("Rust");
  const created = createTopic(server.db, category.id, { text: "Rust news" }, server.clock);
  const topic = interpreted
    ? applyInterpretation(server.db, created.id, { queries: ["rust"], criteria: "Anything about Rust.", suggestedSources: { newsSearch: true, llmSearch: false } })
    : created;
  return { server, category, topic };
}

async function openEditor(s: ReturnType<typeof seeded>) {
  const view = renderApp({ server: s.server, route: `/settings/categories/${s.category.id}` });
  await view.user.click(await screen.findByRole("button", { name: "Rust news を編集" }));
  return view;
}

const proposeButton = () => screen.getByRole("button", { name: "書き直しの案を出す" });

describe("proposals of a topic rewrite", () => {
  it("lists the proposals with what changed, and puts the one chosen into the editor without saving it", async () => {
    const s = seeded();
    const { user, requests } = await openEditor(s);

    await user.click(proposeButton());

    const results = await screen.findByRole("region", { name: "書き直しの案" });
    const items = await within(results).findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Rustのコンパイラーのリリース。入門記事は除く");
    expect(items[0]).toHaveTextContent("判定基準でも入門記事が除かれるはずです。");

    await user.click(within(items[1]!).getByRole("button", { name: "この案を使う" }));

    expect(screen.getByLabelText("トピックの文章")).toHaveValue("Rustのコンパイラーとツールのリリース");
    expect(requests.filter((request) => request.startsWith("PATCH"))).toEqual([]);
    expect(getTopic(s.server.db, s.topic.id).text).toBe("Rust news");
    expect(s.server.llmRequests.proposeTopicRewrite).toHaveLength(1);
    // The editor now holds an unsaved change: no new proposals until it is saved.
    expect(proposeButton()).toBeDisabled();
  });

  it("cannot be asked for while the editor holds unsaved changes, and says why", async () => {
    const s = seeded();
    const { user } = await openEditor(s);
    expect(proposeButton()).toBeEnabled();

    await user.type(screen.getByLabelText("トピックの文章"), " 2.0");

    expect(proposeButton()).toBeDisabled();
    expect(screen.getByText("保存していない変更があります。保存してから案を出してください。")).toBeInTheDocument();
  });

  it("says why no proposal was made when the allowance is used up, or the topic is not interpreted", async () => {
    const limited = seeded({ topicRewritesPerDay: 0 });
    const first = await openEditor(limited);
    await first.user.click(proposeButton());
    const results = await screen.findByRole("region", { name: "書き直しの案" });
    await waitFor(() => expect(results).toHaveTextContent("今日の書き直しの案の上限に達したため、案を出せません。"));
    expect(limited.server.llmRequests.proposeTopicRewrite).toHaveLength(0);
    first.unmount();

    const uninterpreted = seeded({}, false);
    const second = await openEditor(uninterpreted);
    await second.user.click(proposeButton());
    const again = await screen.findByRole("region", { name: "書き直しの案" });
    await waitFor(() => expect(again).toHaveTextContent("トピックの解釈が済んでいないため、案を出せません。次の実行のあとで試してください。"));
  });

  it("says the budget stopped it, and that the proposals could not be had when the task fails", async () => {
    const budget = seeded({ pricing: resolvePricing("claude-sonnet-5-5")!, budget: { monthlyBudgetUsd: 0, warnRatio: 0.8, resetDay: 1 } });
    const first = await openEditor(budget);
    await first.user.click(proposeButton());
    await waitFor(() => expect(screen.getByRole("region", { name: "書き直しの案" })).toHaveTextContent("月の予算に達したため、案を出せません。"));
    first.unmount();

    const failing = seeded({ proposeTopicRewrite: () => ({ proposals: [] }) });
    const second = await openEditor(failing);
    await second.user.click(proposeButton());
    await waitFor(() => expect(screen.getByRole("region", { name: "書き直しの案" })).toHaveTextContent("案を出せませんでした。"));
  });
});
