import { createRule, insertFeed, listRules, type FilterCondition, type RuleCreate } from "@smarternews/core";
import { seedFeedArticle } from "@smarternews/core/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";

const section = (name: string) => screen.findByRole("region", { name });
const title = (value: string): FilterCondition => ({ fields: ["title"], match: "contains", value });
const rule = (value: string, actions: RuleCreate["actions"], scope: RuleCreate["scope"] = { type: "all" }): RuleCreate => ({ scope, conditions: [title(value)], actions });

function feedOf(server: TestServer, name: string, categoryId: number | null = null) {
  return insertFeed(server.db, { url: `https://${name.toLowerCase()}.example.org/feed.xml`, title: name, categoryId }, server.clock);
}

const rowOf = async (text: string) => {
  const list = await section("ルールの一覧");
  return (await within(list).findByText(text)).closest("li")!;
};

describe("the rule page", () => {
  it("opens from the settings page, and explains what rules act on", async () => {
    const { user } = renderApp({ route: "/settings" });
    await user.click(await screen.findByRole("link", { name: "ルールを設定する" }));
    const form = await section("ルールの追加");
    expect(form).toHaveTextContent("新しく届いた配信記事にだけ働きます");
    expect(form).toHaveTextContent("フィルターで隠れた記事");
  });

  it("lists each rule with its scope, conditions, actions and switch", async () => {
    const server = makeServer();
    const feed = feedOf(server, "Status");
    createRule(server.db, rule("障害", ["star", "notify"]), server.clock);
    createRule(server.db, { ...rule("メンテナンス", ["read"], { type: "feed", feedId: feed.id }), enabled: false }, server.clock);
    renderApp({ server, route: "/settings/rules" });

    const first = await rowOf("タイトルに「障害」を含む");
    expect(first).toHaveTextContent("ルール（全体）");
    expect(first).toHaveTextContent("スターを付ける、通知する");
    expect(within(first).queryByText("無効")).toBeNull();
    const second = await rowOf("タイトルに「メンテナンス」を含む");
    expect(second).toHaveTextContent("ルール（購読フィード「Status」）");
    expect(second).toHaveTextContent("既読にする");
    expect(within(second).getByText("無効")).toBeInTheDocument();
  });

  it("says that there are none yet", async () => {
    renderApp({ route: "/settings/rules" });
    expect(await within(await section("ルールの一覧")).findByText("ルールはまだありません。")).toBeInTheDocument();
  });
});

describe("adding a rule", () => {
  it("adds a rule of a feed that stars and notifies, once an action is chosen", async () => {
    const server = makeServer();
    feedOf(server, "Status");
    const { user } = renderApp({ server, route: "/settings/rules" });
    const form = await section("ルールの追加");

    await user.selectOptions(within(form).getByLabelText("範囲"), await within(form).findByRole("option", { name: "Status" }));
    await user.type(within(form).getByLabelText("条件1の値"), "障害");
    expect(within(form).getByRole("button", { name: "ルールを追加" })).toBeDisabled();
    expect(within(form).getByText("操作を1つ以上選んでください。")).toBeInTheDocument();
    await user.click(within(form).getByRole("checkbox", { name: "スターを付ける" }));
    await user.click(within(form).getByRole("checkbox", { name: "通知する" }));
    await user.click(within(form).getByRole("button", { name: "ルールを追加" }));

    expect(await screen.findByText("ルールを追加しました。新しく届く記事に働きます。")).toBeInTheDocument();
    const row = await rowOf("タイトルに「障害」を含む");
    expect(row).toHaveTextContent("ルール（購読フィード「Status」）");
    expect(listRules(server.db)).toEqual([expect.objectContaining({ actions: ["star", "notify"] })]);
    expect(within(form).getByLabelText("条件1の値")).toHaveValue("");
  });

  it("counts the stored articles it meets before saving, and changes none of them", async () => {
    const server = makeServer();
    const feed = feedOf(server, "Status");
    for (const name of ["障害 1", "障害 2", "障害 3", "メンテナンス"]) seedFeedArticle(server.db, feed.id, { title: name });
    const { user } = renderApp({ server, route: "/settings/rules" });
    const form = await section("ルールの追加");

    await user.type(within(form).getByLabelText("条件1の値"), "障害");
    await user.click(within(form).getByRole("checkbox", { name: "既読にする" }));
    await user.click(within(form).getByRole("button", { name: "合う件数を確かめる" }));

    expect(await within(form).findByRole("status")).toHaveTextContent("保存済みの記事のうち3件が条件に合います。ルールは、保存のあとに届く記事にだけ働きます。");
    expect(listRules(server.db)).toEqual([]);
    expect(server.db.prepare("SELECT count(*) AS n FROM articles WHERE is_read = 1").get()).toEqual({ n: 0 });
  });

  it("says that the same rule is there already", async () => {
    const server = makeServer();
    createRule(server.db, rule("障害", ["star"]), server.clock);
    const { user } = renderApp({ server, route: "/settings/rules" });
    const form = await section("ルールの追加");

    await user.type(within(form).getByLabelText("条件1の値"), "障害");
    await user.click(within(form).getByRole("checkbox", { name: "スターを付ける" }));
    await user.click(within(form).getByRole("button", { name: "ルールを追加" }));

    expect(await within(form).findByRole("alert")).toHaveTextContent("同じルールがすでにあります。");
  });
});

describe("changing a rule", () => {
  it("adds an action to a rule", async () => {
    const server = makeServer();
    createRule(server.db, rule("障害", ["star"]), server.clock);
    const { user } = renderApp({ server, route: "/settings/rules" });
    const row = await rowOf("タイトルに「障害」を含む");

    await user.click(within(row).getByRole("button", { name: "ルール（全体）を編集" }));
    const form = within(row).getByRole("form", { name: "ルールの編集" });
    expect(within(form).getByRole("checkbox", { name: "スターを付ける" })).toBeChecked();
    await user.click(within(form).getByRole("checkbox", { name: "既読にする" }));
    await user.click(within(form).getByRole("button", { name: "保存する" }));

    await waitFor(() => expect(row).toHaveTextContent("スターを付ける、既読にする"));
    expect(listRules(server.db)[0]!.actions).toEqual(["star", "read"]);
  });

  it("switches a rule off and on again", async () => {
    const server = makeServer();
    createRule(server.db, rule("障害", ["star"]), server.clock);
    const { user } = renderApp({ server, route: "/settings/rules" });

    await user.click(await screen.findByRole("button", { name: "ルール（全体）を無効にする" }));

    expect(await screen.findByText("ルールを無効にしました。")).toBeInTheDocument();
    const row = await rowOf("タイトルに「障害」を含む");
    await waitFor(() => expect(within(row).getByText("無効")).toBeInTheDocument());
    await user.click(within(row).getByRole("button", { name: "ルール（全体）を有効にする" }));
    await waitFor(() => expect(listRules(server.db)[0]!.enabled).toBe(true));
  });

  it("asks before removing a rule, and removes it once confirmed", async () => {
    const server = makeServer();
    createRule(server.db, rule("障害", ["star"]), server.clock);
    const { user } = renderApp({ server, route: "/settings/rules" });

    await user.click(await screen.findByRole("button", { name: "ルール（全体）を削除" }));
    const dialog = await screen.findByRole("alertdialog", { name: "ルールを削除しますか" });
    expect(dialog).toHaveTextContent("タイトルに「障害」を含む");
    expect(dialog).toHaveTextContent("ルールが付けたスターや既読は、そのまま残ります。");
    expect(listRules(server.db)).toHaveLength(1);

    await user.click(within(dialog).getByRole("button", { name: "削除する" }));

    expect(await screen.findByText("ルールを削除しました。")).toBeInTheDocument();
    expect(await within(await section("ルールの一覧")).findByText("ルールはまだありません。")).toBeInTheDocument();
    expect(listRules(server.db)).toEqual([]);
  });
});

describe("deleting what rules apply to", () => {
  it("says in the feed's question that its rule goes with it, and nothing for a feed without one", async () => {
    const server = makeServer();
    const status = feedOf(server, "Status");
    feedOf(server, "Plain");
    createRule(server.db, rule("障害", ["star"], { type: "feed", feedId: status.id }), server.clock);
    const { user } = renderApp({ server, route: "/settings/feeds" });

    await user.click(await screen.findByRole("button", { name: "Statusの登録を解除" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("この購読フィードを範囲とするルール1件も一緒に削除されます。");
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "やめる" }));
    await user.click(await screen.findByRole("button", { name: "Plainの登録を解除" }));
    expect(await screen.findByRole("alertdialog")).not.toHaveTextContent("ルール");
  });

  it("says in the category's question that its rule goes with it", async () => {
    const server = makeServer();
    const tools = server.category("Tools");
    createRule(server.db, rule("障害", ["star"], { type: "category", categoryId: tools.id }), server.clock);
    const { user } = renderApp({ server, route: `/settings/categories/${tools.id}` });
    await user.click(await screen.findByRole("button", { name: "カテゴリを削除" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("このカテゴリを範囲とするルール1件も一緒に削除されます。");
  });
});
