import { applyInterpretation, createTopic, getTopic, listTopicVersions, setArticleFlags, updateCategory, updateTopic } from "@smarternews/core";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeServer, renderApp } from "../testing/harness.tsx";

const NOW = "2026-03-20T00:00:00.000Z";
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(new Date(NOW).getTime() - days * DAY).toISOString();
const clockAt = (iso: string) => () => new Date(iso);
const interpretation = (criteria: string) => ({ queries: [`${criteria} query`], criteria, suggestedSources: { newsSearch: true, llmSearch: false } });

/** A topic made and interpreted 40 days ago, whose text was changed 10 days ago and interpreted again 9 days ago. */
function seeded() {
  const server = makeServer(NOW);
  const category = server.category("Rust");
  const topic = createTopic(server.db, category.id, { text: "Rust news" }, clockAt(daysAgo(40)));
  applyInterpretation(server.db, topic.id, interpretation("Anything about Rust."), daysAgo(40));
  updateTopic(server.db, topic.id, { text: "Rust compiler releases" }, clockAt(daysAgo(10)));
  applyInterpretation(server.db, topic.id, interpretation("Only compiler releases."), daysAgo(9));
  return { server, category, topic };
}

async function openEditor(s: ReturnType<typeof seeded>) {
  const view = renderApp({ server: s.server, route: `/settings/categories/${s.category.id}` });
  await view.user.click(await screen.findByRole("button", { name: "Rust compiler releases を編集" }));
  const history = await screen.findByRole("region", { name: "履歴" });
  await waitFor(() => expect(within(history).getAllByRole("listitem")).toHaveLength(4));
  return { ...view, history };
}

describe("the history of a topic", () => {
  it("lists the versions newest first, with what made each and what it changed", async () => {
    const s = seeded();
    const { history } = await openEditor(s);

    const items = within(history).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("解釈");
    expect(items[0]).toHaveTextContent("変わった項目：検索語、判定基準");
    expect(items[0]).toHaveTextContent("今の版");
    expect(items[1]).toHaveTextContent("編集");
    expect(items[1]).toHaveTextContent("変わった項目：文章");
    expect(items[3]).toHaveTextContent("作成");
    expect(items[3]).toHaveTextContent("最初の版");
    expect(within(items[0]!).queryByRole("button", { name: "この版に戻す" })).toBeNull();
    expect(within(items[2]!).getByRole("button", { name: "この版に戻す" })).toBeEnabled();
  });

  it("goes back to a version once the dialog confirms it, without interpreting it again", async () => {
    const s = seeded();
    const { user, history } = await openEditor(s);
    const items = within(history).getAllByRole("listitem");

    await user.click(within(items[2]!).getByRole("button", { name: "この版に戻す" }));
    const dialog = await screen.findByRole("alertdialog", { name: "この版に戻しますか" });
    expect(dialog).toHaveTextContent("解釈済みの版なので、解釈し直しません。");
    await user.click(within(dialog).getByRole("button", { name: "戻す" }));

    expect(await screen.findByText("この版に戻しました")).toBeInTheDocument();
    expect(getTopic(s.server.db, s.topic.id)).toMatchObject({ text: "Rust news", interpreted: true, criteria: "Anything about Rust." });
    expect(listTopicVersions(s.server.db, s.topic.id)[0]).toMatchObject({ trigger: "restored" });
    const fresh = await screen.findByRole("region", { name: "履歴" });
    await waitFor(() => expect(within(fresh).getAllByRole("listitem")).toHaveLength(5));
    expect(within(fresh).getAllByRole("listitem")[0]).toHaveTextContent("版に戻す");
    await waitFor(() => expect(screen.getByLabelText("トピックの文章")).toHaveValue("Rust news"));
    expect(Object.values(s.server.llmRequests).flat()).toHaveLength(0);
  });

  it("changes nothing when the dialog is dismissed", async () => {
    const s = seeded();
    const { user, history, requests } = await openEditor(s);

    await user.click(within(within(history).getAllByRole("listitem")[3]!).getByRole("button", { name: "この版に戻す" }));
    const dialog = await screen.findByRole("alertdialog", { name: "この版に戻しますか" });
    expect(dialog).toHaveTextContent("解釈が済んでいない版なので、次の実行で解釈されます。");
    await user.click(within(dialog).getByRole("button", { name: "やめる" }));

    expect(requests.filter((request) => request.includes("/restore"))).toEqual([]);
    expect(getTopic(s.server.db, s.topic.id).text).toBe("Rust compiler releases");
  });

  it("cannot go back while the editor holds unsaved changes, and says why", async () => {
    const s = seeded();
    const { user, history } = await openEditor(s);

    await user.type(screen.getByLabelText("トピックの文章"), " 2.0");

    for (const button of within(history).getAllByRole("button", { name: "この版に戻す" })) expect(button).toBeDisabled();
    expect(within(history).getByText("保存していない変更があります。保存するか、変更を取り消してから戻してください。")).toBeInTheDocument();
  });
});

describe("the stats of a topic around its last change", () => {
  it("shows the counts before and after the change side by side", async () => {
    const s = seeded();
    const at = (iso: string, missed: boolean) => {
      s.server.clock.set(iso);
      const id = s.server.article(s.category.id, { topicIds: [s.topic.id] });
      if (missed) setArticleFlags(s.server.db, id, { missed: true }, iso);
    };
    for (const missed of [true, true, false, false, false]) at(daysAgo(20), missed);
    for (let i = 0; i < 3; i += 1) at(daysAgo(5), false);
    s.server.clock.set(NOW);

    renderApp({ server: s.server, route: `/settings/categories/${s.category.id}` });

    const stats = await screen.findByRole("region", { name: "トピックの成績" });
    const before = await within(stats).findByRole("region", { name: "変更前（3月11日まで）" });
    const after = within(stats).getByRole("region", { name: "変更後（3月11日から）" });
    expect(before).toHaveTextContent("外れ2/5件（40%）");
    expect(after).toHaveTextContent("外れ0/3件（0%）");
    expect(stats).toHaveTextContent("3月11日の解釈で分けています。");
  });

  it("keeps one column for a topic that did not change in the period", async () => {
    const server = makeServer(NOW);
    const category = server.category("Rust");
    const topic = createTopic(server.db, category.id, { text: "Rust news" }, clockAt(daysAgo(40)));
    applyInterpretation(server.db, topic.id, interpretation("Anything."), daysAgo(40));

    renderApp({ server, route: `/settings/categories/${category.id}` });

    const stats = await screen.findByRole("region", { name: "トピックの成績" });
    await within(stats).findByText("Rust news");
    expect(within(stats).queryByRole("region", { name: /変更前/ })).toBeNull();
  });
});

describe("the history of a category", () => {
  it("lists the minimum importance and the limit of articles each time they changed", async () => {
    const server = makeServer(NOW);
    const category = server.category("Rust");
    updateCategory(server.db, category.id, { minImportance: 4 }, clockAt(daysAgo(2)));

    renderApp({ server, route: `/settings/categories/${category.id}` });

    const history = await screen.findByRole("region", { name: "最低重要度と件数上限の履歴" });
    await waitFor(() => expect(within(history).getAllByRole("listitem")).toHaveLength(2));
    const items = within(history).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("編集");
    expect(items[0]).toHaveTextContent("最低重要度 4");
    expect(items[0]).toHaveTextContent("件数上限 5");
    expect(items[1]).toHaveTextContent("作成");
    expect(items[1]).toHaveTextContent("最低重要度 3");
    expect(within(history).queryByRole("button")).toBeNull();
  });
});
