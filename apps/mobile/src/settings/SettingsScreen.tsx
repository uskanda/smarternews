import { formatFull, messageFor, NOTIFY_SETTING_LABEL, stageLabel, STATUS_LABEL, type NotifySetting } from "@smarternews/client";
import type { Category, Run } from "@smarternews/core/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "../api/AppProvider";
import { useCategories, useRuns, useSettings, useTimeZone } from "../api/queries";
import { useConnection } from "../connection/ConnectionProvider";
import { useBack } from "../lib/back";
import { useNotify } from "../notifications/NotificationsBridge";
import { stopNotifications } from "../notifications/setup";
import { clearNotifyState } from "../notifications/store";
import { useTheme } from "../theme/theme";
import { Button, ErrorNotice, IconButton, Loading, Notice } from "../ui/controls";
import { ScreenHeader } from "../ui/ScreenHeader";
import { Section } from "../ui/Section";
import { Sheet } from "../ui/Sheet";
import { Txt } from "../ui/Txt";

const active = (run: Run | undefined) => run?.status === "queued" || run?.status === "running";

/** One category: what its latest run did, and a button to run it now. Pressing the line shows what failed. */
function CategoryRun({ category, run, timeZone }: { category: Category; run: Run | undefined; timeZone: string }) {
  const theme = useTheme();
  const { api } = useApp();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const start = useMutation({
    mutationFn: () => api.runCategory(category.id),
    onSettled: () => client.invalidateQueries({ queryKey: ["runs"] }),
  });

  const busy = active(run) || start.isPending;
  const parts = !run
    ? ["まだ実行していません"]
    : active(run)
      ? [STATUS_LABEL[run.status]]
      : [STATUS_LABEL[run.status], run.finishedAt ? `${formatFull(run.finishedAt, timeZone)} に終了` : null, `記事${run.articlesCreated + run.articlesUpdated}件`].filter(
          (part): part is string => part !== null,
        );
  const failures = run?.failures ?? [];
  const troubled = run?.status === "failed" || run?.status === "partial" || run?.status === "stopped_by_limit";

  return (
    <View style={{ gap: theme.spacing.xs, borderBottomWidth: 1, borderBottomColor: theme.colors.outline, paddingBottom: theme.spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.md }}>
        {failures.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={[category.name, ...parts].join("。")}
            accessibilityState={{ expanded: open }}
            onPress={() => setOpen((current) => !current)}
            style={{ flex: 1, minHeight: theme.spacing["touch-android"], justifyContent: "center" }}
          >
            <Txt variant="label-md">{category.name}</Txt>
            <Txt variant="label-sm" color={troubled ? "warning" : "on-surface-muted"}>
              {parts.join(" ・ ")} ・ {open ? "内容を閉じる" : "内容を見る"}
            </Txt>
          </Pressable>
        ) : (
          // Nothing to open: plain text, read out as one line.
          <View accessible accessibilityLabel={[category.name, ...parts].join("。")} style={{ flex: 1, minHeight: theme.spacing["touch-android"], justifyContent: "center" }}>
            <Txt variant="label-md">{category.name}</Txt>
            <Txt variant="label-sm" color={troubled ? "warning" : "on-surface-muted"}>
              {parts.join(" ・ ")}
            </Txt>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${category.name}をいま実行`}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => start.mutate()}
          style={({ pressed }) => ({
            minHeight: theme.spacing["touch-android"],
            minWidth: theme.spacing["touch-android"],
            paddingHorizontal: theme.spacing.md,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderRadius: theme.rounded.md,
            borderColor: pressed ? theme.colors.primary : theme.colors["outline-strong"],
            backgroundColor: pressed ? theme.colors.selected : theme.colors.surface,
            opacity: busy ? 0.5 : 1,
          })}
        >
          <Txt variant="label-md">{busy ? "実行中" : "いま実行"}</Txt>
        </Pressable>
      </View>
      {start.isError ? <Notice tone="error">{messageFor(start.error)}</Notice> : null}
      {run?.status === "stopped_by_limit" ? (
        <Txt variant="label-sm" color="on-surface-muted">
          LLMの呼び出し回数が上限に達したため、途中で止まりました。
        </Txt>
      ) : null}
      {open
        ? failures.map((failure, index) => (
            <View key={index} style={{ gap: 2, paddingLeft: theme.spacing.md, borderLeftWidth: 2, borderLeftColor: theme.colors["outline-strong"] }}>
              <Txt variant="label-md">{stageLabel(failure.stage)}</Txt>
              <Txt variant="label-sm" color="on-surface-muted">
                {failure.target}
              </Txt>
              <Txt variant="body-md">{failure.message}</Txt>
            </View>
          ))
        : null}
    </View>
  );
}

function NotifyChoice() {
  const theme = useTheme();
  const { setting, choose: apply } = useNotify();
  const [busy, setBusy] = useState(false);

  async function choose(next: NotifySetting) {
    setBusy(true);
    try {
      await apply(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="通知">
      {(Object.keys(NOTIFY_SETTING_LABEL) as NotifySetting[]).map((option) => {
        const selected = setting === option;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityLabel={NOTIFY_SETTING_LABEL[option]}
            accessibilityState={{ checked: selected, disabled: busy }}
            disabled={busy || setting === null}
            onPress={() => void choose(option)}
            style={{ minHeight: theme.spacing["touch-android"], flexDirection: "row", alignItems: "center", gap: theme.spacing.md }}
          >
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 10,
                borderWidth: 2,
                borderColor: selected ? theme.colors.primary : theme.colors["outline-strong"],
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.primary }} /> : null}
            </View>
            <Txt variant={selected ? "label-md" : "body-md"}>{NOTIFY_SETTING_LABEL[option]}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** What the app itself can change: reader information, a run of a category, notifications, and the connection. */
export function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const back = useBack("/list/unread");
  const insets = useSafeAreaInsets();
  const { serverUrl } = useApp();
  const { disconnect } = useConnection();
  const timeZone = useTimeZone();
  const settings = useSettings();
  const categories = useCategories();
  const runs = useRuns();
  const { refused } = useNotify();
  const [confirming, setConfirming] = useState(false);

  // The newest run of each category: the list comes newest first.
  const latest = new Map<number, Run>();
  for (const run of runs.data ?? []) if (!latest.has(run.categoryId)) latest.set(run.categoryId, run);

  async function leave() {
    setConfirming(false);
    await stopNotifications();
    await clearNotifyState();
    await disconnect();
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <ScreenHeader title="設定" left={<IconButton label="一覧へ戻る" icon="back" onPress={back} />} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + theme.spacing.xl }}>
        <Section title="読み手情報">
          {settings.isError ? <ErrorNotice error={settings.error} onRetry={() => void settings.refetch()} /> : null}
          <Txt variant="body-md" color="on-surface-muted" numberOfLines={3}>
            {settings.data ? settings.data.readerInfo || "まだ書かれていません。" : ""}
          </Txt>
          <Button label="読み手情報を編集する" onPress={() => router.push("/settings/reader-info")} style={{ alignSelf: "flex-start" }} />
        </Section>

        <Section title="カテゴリの実行">
          {categories.isError ? <ErrorNotice error={categories.error} onRetry={() => void categories.refetch()} /> : null}
          {categories.isPending || runs.isPending ? <Loading /> : null}
          {categories.isSuccess && categories.data.length === 0 ? (
            <Txt variant="body-md" color="on-surface-muted">
              カテゴリがまだありません。Webの画面で追加してください。
            </Txt>
          ) : null}
          {runs.isSuccess ? (categories.data ?? []).map((category) => <CategoryRun key={category.id} category={category} run={latest.get(category.id)} timeZone={timeZone} />) : null}
        </Section>

        <Section title="通知">
          <Txt variant="body-md" color="on-surface-muted">
            アプリを閉じている間も、端末がときどきサーバーを確かめ、新着の記事を知らせます。確かめる時刻は端末が決めるので、遅れることがあります。
          </Txt>
          <NotifyChoice />
          {refused ? <Notice tone="warning">通知を出すには、端末の許可が必要です。端末の設定でこのアプリの通知を許可してから、もう一度選んでください。</Notice> : null}
        </Section>

        <Section title="接続">
          <View style={{ gap: 2 }}>
            <Txt variant="label-sm" color="on-surface-muted">
              接続中のサーバー
            </Txt>
            <Txt variant="body-md" selectable>
              {serverUrl}
            </Txt>
          </View>
          <Txt variant="label-sm" color="on-surface-muted">
            版 {Constants.expoConfig?.version ?? "0.0.0"}
          </Txt>
          <Txt variant="body-md" color="on-surface-muted">
            カテゴリとトピックの編集、設定ファイル、除外した候補の確認は、Webの画面で行います。
          </Txt>
          <Button label="Webの画面を開く" onPress={() => void Linking.openURL(serverUrl)} style={{ alignSelf: "flex-start" }} />
          <Button label="接続を解除する" variant="quiet" onPress={() => setConfirming(true)} style={{ alignSelf: "flex-start" }} />
        </Section>
      </ScrollView>

      <Sheet title="接続を解除しますか" visible={confirming} onClose={() => setConfirming(false)}>
        <Txt variant="body-md">この端末から、サーバーのURLとトークンを消します。サーバーの記事と設定は変わりません。</Txt>
        <Button label="解除する" variant="danger" onPress={() => void leave()} />
        <Button label="やめる" onPress={() => setConfirming(false)} />
      </Sheet>
    </View>
  );
}
