import { addHighlightTerm, createTermGroup, listTermGroups, type TermColor } from "@smarternews/core";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";

const section = (name: string) => screen.findByRole("region", { name });
const groupsList = async () => within(await section("語のまとまりの一覧")).findByRole("list", { name: "語のまとまり" });
/** Each group as "name 色 term term". */
const shown = async () =>
  within(await groupsList())
    .queryAllByRole("listitem")
    .filter((item) => item.hasAttribute("data-group"))
    .map((item) => item.getAttribute("data-group-summary"));
const groupItem = async (name: string) => (await groupsList()).querySelector(`[data-group="${name}"]`) as HTMLElement;

function group(server: TestServer, name: string, color: TermColor, ...terms: string[]) {
  const created = createTermGroup(server.db, { name, color }, server.clock);
  for (const text of terms) addHighlightTerm(server.db, created.id, { text }, server.clock);
  return created;
}

describe("the settings page", () => {
  it("has a section for term highlights right after the subscribed feeds, which explains them and opens their page", async () => {
    const { user, path } = renderApp({ route: "/settings" });
    const feeds = await section("購読フィード");
    const highlights = await section("語の色付け");

    expect(feeds.nextElementSibling).toBe(highlights);
    expect(highlights).toHaveTextContent("生成記事と配信記事の両方");
    expect(highlights).toHaveTextContent("記事を隠しません");
    await user.click(within(highlights).getByRole("link", { name: "語の色付けを設定する" }));
    expect(path()).toBe("/settings/term-highlights");
  });

  it("names term groups in what the settings file holds, and counts what a file created", async () => {
    const server = makeServer();
    const { user } = renderApp({ server, route: "/settings" });
    const settingsFile = await section("設定ファイル");
    expect(settingsFile).toHaveTextContent("語の色付け");
    const file = new File(["version: 1\ntermGroups:\n  - name: 通商\n    color: orange\n    terms: [関税, 輸出]\n"], "settings.yaml", { type: "application/yaml" });

    await user.upload(within(settingsFile).getByLabelText("読み込む設定ファイル"), file);
    await user.click(within(settingsFile).getByRole("button", { name: "読み込む" }));

    await waitFor(() => expect(settingsFile).toHaveTextContent("語のまとまりを1件作成、語を2件追加"));
  });
});

describe("the term highlights page", () => {
  it("lists the groups in their order with name, colour and terms", async () => {
    const server = makeServer();
    group(server, "A", "green", "規制", "関税");
    group(server, "B", "purple");
    renderApp({ server, route: "/settings/term-highlights" });

    await waitFor(async () => expect(await shown()).toEqual(["A 緑 規制 関税", "B 紫"]));
  });

  it("adds a group with the colour chosen, at the end, and says when the name is taken", async () => {
    const server = makeServer();
    group(server, "半導体", "green");
    const { user } = renderApp({ server, route: "/settings/term-highlights" });
    const form = await section("語のまとまりの追加");

    await user.type(within(form).getByLabelText("まとまりの名前"), "通商");
    await user.click(within(form).getByRole("radio", { name: "橙色" }));
    await user.click(within(form).getByRole("button", { name: "まとまりを追加" }));
    await waitFor(async () => expect(await shown()).toEqual(["半導体 緑", "通商 橙色"]));

    await user.type(within(form).getByLabelText("まとまりの名前"), "通商");
    await user.click(within(form).getByRole("button", { name: "まとまりを追加" }));
    expect(await within(form).findByText(/登録済み/)).toBeInTheDocument();
    expect(await shown()).toEqual(["半導体 緑", "通商 橙色"]);
  });

  it("lets the colour be chosen with the arrow keys, each colour named", async () => {
    const { user } = renderApp({ route: "/settings/term-highlights" });
    const form = await section("語のまとまりの追加");
    const colors = within(form).getByRole("radiogroup", { name: "色" });
    expect(within(colors).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label") ?? radio.closest("label")?.textContent)).toEqual([
      "緑",
      "紫",
      "桃色",
      "橙色",
    ]);
    within(colors).getByRole("radio", { name: "緑" }).focus();

    await user.keyboard("{ArrowDown}");

    expect(within(colors).getByRole("radio", { name: "紫" })).toBeChecked();
    expect(within(colors).getByRole("radio", { name: "紫" })).toHaveFocus();
  });

  it("changes the colour of a group", async () => {
    const server = makeServer();
    group(server, "A", "green", "規制");
    const { user } = renderApp({ server, route: "/settings/term-highlights" });
    const item = await waitFor(() => groupItem("A"));

    await user.click(within(item).getByRole("button", { name: "Aを編集" }));
    await user.click(within(item).getByRole("radio", { name: "桃色" }));
    await user.click(within(item).getByRole("button", { name: "保存" }));

    await waitFor(async () => expect(await shown()).toEqual(["A 桃色 規制"]));
    expect(listTermGroups(server.db)[0]).toMatchObject({ color: "pink" });
  });

  it("asks before deleting a group, saying how many terms go with it", async () => {
    const server = makeServer();
    group(server, "A", "green", "規制", "関税", "補助金");
    group(server, "B", "purple");
    const { user } = renderApp({ server, route: "/settings/term-highlights" });
    const item = await waitFor(() => groupItem("A"));

    await user.click(within(item).getByRole("button", { name: "Aを削除" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("語3つも消えます");
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));

    await waitFor(async () => expect(await shown()).toEqual(["B 紫"]));
  });

  it("adds a term to a group, refuses one it has in another width, and removes one", async () => {
    const server = makeServer();
    group(server, "通商", "orange", "TSMC");
    const { user } = renderApp({ server, route: "/settings/term-highlights" });
    const item = await waitFor(() => groupItem("通商"));

    await user.type(within(item).getByLabelText("「通商」に足す語"), "関税");
    await user.click(within(item).getByRole("button", { name: "語を追加" }));
    await waitFor(async () => expect(await shown()).toEqual(["通商 橙色 TSMC 関税"]));

    await user.type(within(item).getByLabelText("「通商」に足す語"), "ＴＳＭＣ");
    await user.click(within(item).getByRole("button", { name: "語を追加" }));
    expect(await within(item).findByText(/登録済み/)).toBeInTheDocument();
    expect(await shown()).toEqual(["通商 橙色 TSMC 関税"]);

    await user.click(within(item).getByRole("button", { name: "「関税」を削除" }));
    await waitFor(async () => expect(await shown()).toEqual(["通商 橙色 TSMC"]));
  });

  it("moves a group up and down, cannot move the first up or the last down, and keeps the focus on the moved group", async () => {
    const server = makeServer();
    group(server, "A", "green");
    group(server, "B", "purple");
    const { user } = renderApp({ server, route: "/settings/term-highlights" });
    const a = await waitFor(() => groupItem("A"));
    expect(within(a).getByRole("button", { name: "Aを上へ" })).toBeDisabled();
    expect(within(await groupItem("B")).getByRole("button", { name: "Bを下へ" })).toBeDisabled();

    within(await groupItem("B")).getByRole("button", { name: "Bを上へ" }).focus();
    await user.keyboard("{Enter}");

    await waitFor(async () => expect(await shown()).toEqual(["B 紫", "A 緑"]));
    await waitFor(async () => expect(within(await groupItem("B")).getByRole("button", { name: "Bを下へ" })).toHaveFocus());
    await user.click(within(await groupItem("B")).getByRole("button", { name: "Bを下へ" }));
    await waitFor(async () => expect(await shown()).toEqual(["A 緑", "B 紫"]));
  });

  it("says near the order that the upper group colours a place two groups match", async () => {
    renderApp({ route: "/settings/term-highlights" });
    expect(await section("語のまとまりの一覧")).toHaveTextContent("上にあるまとまりの色");
  });
});

describe("a change of the terms", () => {
  it("colours the list without a reload once a term is added", async () => {
    const server = makeServer();
    const category = server.category("Alpha");
    server.article(category.id, { title: "関税の話", summary: "要約" });
    group(server, "通商", "orange");
    const { user } = renderApp({ server, route: "/all" });
    const list = await section("記事の一覧");
    await within(list).findByText("関税の話");
    expect(list.querySelector("mark.term-match")).toBeNull();

    await user.click(screen.getByRole("link", { name: "設定" }));
    await user.click(await screen.findByRole("link", { name: "語の色付けを設定する" }));
    const item = await waitFor(() => groupItem("通商"));
    await user.type(within(item).getByLabelText("「通商」に足す語"), "関税");
    await user.click(within(item).getByRole("button", { name: "語を追加" }));
    await waitFor(async () => expect(await shown()).toEqual(["通商 橙色 関税"]));
    await user.click(screen.getByRole("link", { name: /すべて/ }));

    const back = await section("記事の一覧");
    await waitFor(() => expect(back.querySelector("mark.term-match")).toHaveTextContent("関税"));
  });
});
