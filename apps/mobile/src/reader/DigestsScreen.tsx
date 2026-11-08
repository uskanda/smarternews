import { dayKey, formatClock, formatFull } from "@smarternews/client";
import type { Digest, DigestSummary } from "@smarternews/core/api";
import { DrawerActions } from "@react-navigation/native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDigest, useDigests, useTimeZone } from "../api/queries";
import { useTheme } from "../theme/theme";
import { ErrorNotice, IconButton, Loading } from "../ui/controls";
import { ScreenHeader } from "../ui/ScreenHeader";
import { Txt } from "../ui/Txt";

/** The hours a digest covers: the end as a time only when it falls on the day the period starts. */
function periodLabel(digest: Pick<DigestSummary, "periodStart" | "periodEnd">, timeZone: string): string {
  const sameDay = dayKey(digest.periodStart, timeZone) === dayKey(digest.periodEnd, timeZone);
  return `${formatFull(digest.periodStart, timeZone)} 〜 ${sameDay ? formatClock(digest.periodEnd, timeZone) : formatFull(digest.periodEnd, timeZone)}`;
}

/** A pressable line of text, such as the title of a source article. At least 48dp high. */
function LinkRow({ label, selected, onPress, children }: { label: string; selected?: boolean; onPress: () => void; children: ReactNode }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress}
      android_ripple={{ color: theme.colors.selected }}
      style={({ pressed }) => ({
        minHeight: theme.spacing["touch-android"],
        justifyContent: "center",
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.xs,
        backgroundColor: selected || pressed ? theme.colors.selected : "transparent",
      })}
    >
      {children}
    </Pressable>
  );
}

function DigestBody({ digest, timeZone, onOpenArticle }: { digest: Digest; timeZone: string; onOpenArticle: (id: number) => void }) {
  const theme = useTheme();
  // A line names its sources by id; an article deleted since has no title and is left out.
  const titles = new Map(digest.articles.map((article) => [article.id, article.title]));
  return (
    <View style={{ gap: theme.spacing.lg, paddingVertical: theme.spacing.lg }}>
      <View style={{ gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg }}>
        <Txt variant="label-sm" color="on-surface-muted">
          {periodLabel(digest, timeZone)}
        </Txt>
        <Txt variant="body-lg">{digest.executiveSummary}</Txt>
      </View>
      {digest.sections.map((section) => (
        <View key={section.categoryId} style={{ gap: theme.spacing.sm }}>
          <Txt variant="headline-md" heading style={{ paddingHorizontal: theme.spacing.lg }}>
            {section.categoryName}
          </Txt>
          {section.lines.map((line, index) => (
            <View key={index} style={{ gap: theme.spacing.xs }}>
              <Txt variant="body-md" style={{ paddingHorizontal: theme.spacing.lg }}>
                {line.text}
              </Txt>
              {line.articleIds.flatMap((id) => {
                const title = titles.get(id);
                return title === undefined
                  ? []
                  : [
                      <LinkRow key={id} label={title} onPress={() => onOpenArticle(id)}>
                        <Txt variant="label-sm" color="primary" numberOfLines={2}>
                          {title}
                        </Txt>
                      </LinkRow>,
                    ];
              })}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * The digests: the one chosen, or the latest, with its executive summary and a section per category, and below
 * it every digest kept, to switch to another. A source article opens on the article screen.
 */
export function DigestsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const timeZone = useTimeZone();
  const params = useLocalSearchParams<{ digestId?: string }>();
  const list = useDigests();
  const items = list.data?.items ?? [];
  const asked = params.digestId !== undefined && /^\d+$/.test(params.digestId) ? Number(params.digestId) : null;
  const shownId = asked ?? items[0]?.id ?? null;
  const digest = useDigest(shownId);

  const header = <ScreenHeader title="ダイジェスト" left={<IconButton label="項目を開く" icon="menu" onPress={() => navigation.dispatch(DrawerActions.openDrawer())} />} />;

  let content: ReactNode;
  if (list.isPending) content = <Loading />;
  else if (list.isError) content = <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />;
  else if (items.length === 0 && asked === null) {
    content = (
      <View style={{ gap: theme.spacing.sm, padding: theme.spacing.lg }}>
        <Txt variant="body-md">ダイジェストはまだありません。</Txt>
        <Txt variant="label-sm" color="on-surface-muted">
          作る時刻は、Webの画面の設定で決めます。
        </Txt>
      </View>
    );
  } else {
    content = (
      <>
        {digest.isPending ? (
          <Loading />
        ) : digest.isError ? (
          <ErrorNotice error={digest.error} onRetry={() => void digest.refetch()} />
        ) : (
          <DigestBody
            digest={digest.data}
            timeZone={timeZone}
            onOpenArticle={(id) => router.push({ pathname: "/article/[id]", params: { id: String(id), list: "all", read: "1" } })}
          />
        )}
        <View style={{ gap: theme.spacing.xs, paddingVertical: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.colors.outline }}>
          <Txt variant="headline-md" heading style={{ paddingHorizontal: theme.spacing.lg }}>
            過去のダイジェスト
          </Txt>
          <View testID="digest-history">
            {items.map((item) => (
              <LinkRow key={item.id} label={formatFull(item.createdAt, timeZone)} selected={item.id === shownId} onPress={() => router.setParams({ digestId: String(item.id) })}>
                <Txt variant={item.id === shownId ? "label-md" : "body-md"}>{formatFull(item.createdAt, timeZone)}</Txt>
                <Txt variant="label-sm" color="on-surface-muted">
                  {`${item.articleCount}件の記事から`}
                </Txt>
              </LinkRow>
            ))}
          </View>
        </View>
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      {header}
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + theme.spacing.lg }}>{content}</ScrollView>
    </View>
  );
}
