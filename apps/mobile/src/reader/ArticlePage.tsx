import { ApiError, eventTime, formatDay, formatFull, registrationLabel } from "@smarternews/client";
import type { Article } from "@smarternews/core/api";
import { memo, useEffect, useRef } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useArticle, useCategories, useTimeZone } from "../api/queries";
import { openSource } from "../lib/links";
import { useTheme } from "../theme/theme";
import { ErrorNotice, Loading } from "../ui/controls";
import { Txt } from "../ui/Txt";
import { Badge } from "./ArticleRow";
import { Markdown } from "./Markdown";

function EventDetails({ article, timeZone }: { article: Article; timeZone: string }) {
  const theme = useTheme();
  const event = article.event!;
  const day = formatDay(event.startsAt, timeZone);
  const rows: Array<[string, string | null]> = [
    ["日時", `${day.date} ${day.weekday} ${eventTime(event, timeZone)}`],
    ["会場", event.venue],
    ["料金", event.fee],
    ["申込", registrationLabel(event.registration)],
  ];
  return (
    <View style={{ gap: theme.spacing.xs }}>
      {rows.map(([name, value]) =>
        value ? (
          <View key={name} accessible accessibilityLabel={`${name} ${value}`} style={{ flexDirection: "row", gap: theme.spacing.lg }}>
            <Txt variant="body-md" color="on-surface-muted">
              {name}
            </Txt>
            <Txt variant="body-md" style={{ flex: 1 }}>
              {value}
            </Txt>
          </View>
        ) : null,
      )}
    </View>
  );
}

export interface ArticlePageProps {
  id: number;
  /** True for the page the user is looking at. Only that page marks its article as read. */
  active: boolean;
  width: number;
  /** The name of the article's category when the list knows it; the page looks it up itself otherwise. */
  categoryName: string;
  onRead: (article: Article) => void;
  onOpenArticle: (id: number) => void;
}

/** One article: what the story is, what it means for the reader, the text, and where it came from. */
export const ArticlePage = memo(function ArticlePage({ id, active, width, categoryName, onRead, onOpenArticle }: ArticlePageProps) {
  const theme = useTheme();
  const timeZone = useTimeZone();
  const categories = useCategories();
  const query = useArticle(id);
  const article = query.data;
  const previous = useArticle(article?.previousArticleId ?? null).data;

  // Looking at an unread article marks it as read, once: putting it back to unread must hold while it is open.
  const marked = useRef(false);
  useEffect(() => {
    if (!active || !article || marked.current) return;
    marked.current = true;
    if (!article.isRead) onRead(article);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the page becomes the one in view or its article arrives
  }, [active, article?.id]);

  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.kind === "not_found";
    return (
      <View style={{ width }}>
        {missing ? (
          <Txt variant="body-md" style={{ padding: theme.spacing.lg }}>
            この記事はありません。保存期間を過ぎて削除された可能性があります。
          </Txt>
        ) : (
          <ErrorNotice error={query.error} onRetry={() => void query.refetch()} />
        )}
      </View>
    );
  }
  if (!article) {
    return (
      <View style={{ width }}>
        <Loading />
      </View>
    );
  }

  const meta = [
    categoryName || (categories.data?.find((entry) => entry.id === article.categoryId)?.name ?? ""),
    `${formatFull(article.updatedAt, timeZone)} に更新`,
    `重要度 ${article.importance}`,
    article.revision > 0 ? `更新 ${article.revision}回` : null,
    article.starred ? "スター" : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <ScrollView accessibilityLabel="記事" style={{ width }} contentContainerStyle={{ gap: theme.spacing.lg, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.xl }}>
      {/* One stop for a screen reader, not one per fact. */}
      <View accessible accessibilityLabel={meta.join("、")} style={{ flexDirection: "row", flexWrap: "wrap", columnGap: theme.spacing.md, rowGap: theme.spacing.xs }}>
        {meta.map((part) => (
          <Txt key={part} variant="label-sm" color="on-surface-muted">
            {part}
          </Txt>
        ))}
      </View>
      <Txt variant="headline-lg" heading>
        {article.title}
      </Txt>
      {article.unconfirmed ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
          <Badge tone="warning">未確認</Badge>
          <Txt variant="body-md" style={{ flex: 1 }}>
            噂や非公式の情報に基づいています。
          </Txt>
        </View>
      ) : null}
      {article.impact ? (
        <View testID="impact" style={{ gap: theme.spacing.xs, paddingLeft: theme.spacing.md, borderLeftWidth: theme.spacing.xs, borderLeftColor: theme.colors.mark }}>
          <Txt variant="label-sm" color="on-surface-muted">
            読み手への影響
          </Txt>
          <Txt variant="body-md">{article.impact}</Txt>
        </View>
      ) : null}
      {article.event ? <EventDetails article={article} timeZone={timeZone} /> : null}
      <Markdown text={article.body} />
      {previous ? (
        <View style={{ gap: theme.spacing.xs }}>
          <Txt variant="label-sm" color="on-surface-muted">
            この話題の前の記事
          </Txt>
          <Pressable accessibilityRole="link" onPress={() => onOpenArticle(previous.id)} style={{ minHeight: theme.spacing["touch-android"], justifyContent: "center" }}>
            <Txt variant="body-md" color="primary" style={{ textDecorationLine: "underline" }}>
              {previous.title}
            </Txt>
          </Pressable>
        </View>
      ) : null}
      <View style={{ gap: theme.spacing.xs }}>
        <Txt variant="label-sm" color="on-surface-muted">
          出典
        </Txt>
        {article.snippetOnly ? (
          <Txt variant="label-sm" color="on-surface-muted">
            出典のページを読めなかったため、抜粋から書いています。
          </Txt>
        ) : null}
        {article.refs.map((ref) => (
          <Pressable
            key={ref.url}
            accessibilityRole="link"
            accessibilityLabel={[ref.title || ref.url, ref.siteName].filter(Boolean).join("、")}
            onPress={() => void openSource(ref.url)}
            style={{ minHeight: theme.spacing["touch-android"], justifyContent: "center" }}
          >
            <Txt variant="body-md" color="primary" style={{ textDecorationLine: "underline" }}>
              {ref.title || ref.url}
            </Txt>
            {ref.siteName ? (
              <Txt variant="label-sm" color="on-surface-muted">
                {ref.siteName}
              </Txt>
            ) : null}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
});
