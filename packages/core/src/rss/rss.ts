import type { Article } from "../api.ts";
import { escapeHtml } from "../markdown.ts";

export interface FeedOptions {
  title: string;
  /** Link of the channel, and of items that have no reference. */
  link: string;
  description: string;
  /** Output language of the articles; it also picks the labels below. */
  language: string;
  timeZone: string;
  articles: Article[];
  categoryNames: Map<number, string>;
}

const LABELS = {
  en: {
    updated: "[Updated] ",
    unconfirmed: "Unconfirmed: based on rumours or unofficial information.",
    impact: "For you",
    sources: "Sources",
    when: "When",
    where: "Where",
    fee: "Fee",
    registration: "Registration",
    required: "required",
    not_required: "not required",
  },
  ja: {
    updated: "【更新】",
    unconfirmed: "未確認：噂や非公式の情報に基づいています。",
    impact: "読み手への影響",
    sources: "出典",
    when: "日時",
    where: "会場",
    fee: "料金",
    registration: "申込",
    required: "必要",
    not_required: "不要",
  },
};

function labelsFor(language: string) {
  return language.toLowerCase().startsWith("ja") ? LABELS.ja : LABELS.en;
}

/** Text for an XML element or attribute: escaped, and without the control characters XML 1.0 forbids. */
function xmlText(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function when(article: Article, language: string, timeZone: string): string {
  const format = new Intl.DateTimeFormat(language, { timeZone, dateStyle: "medium", timeStyle: "short" });
  const start = new Date(article.event!.startsAt);
  const end = new Date(article.event!.endsAt);
  return `${format.format(start)} – ${format.format(end)}`;
}

function contentHtml(article: Article, options: FeedOptions): string {
  const labels = labelsFor(options.language);
  const parts: string[] = [];
  if (article.unconfirmed) parts.push(`<p><strong>${escapeHtml(labels.unconfirmed)}</strong></p>`);
  if (article.event) {
    const lines = [`${labels.when}: ${escapeHtml(when(article, options.language, options.timeZone))}`];
    if (article.event.venue) lines.push(`${labels.where}: ${escapeHtml(article.event.venue)}`);
    if (article.event.fee) lines.push(`${labels.fee}: ${escapeHtml(article.event.fee)}`);
    if (article.event.registration !== "unknown") lines.push(`${labels.registration}: ${labels[article.event.registration]}`);
    parts.push(`<p>${lines.join("<br>")}</p>`);
  }
  if (article.impact) parts.push(`<p><strong>${escapeHtml(labels.impact)}:</strong> ${escapeHtml(article.impact)}</p>`);
  parts.push(article.bodyHtml);
  if (article.refs.length > 0) {
    const links = article.refs.map((ref) => {
      const label = [ref.title || ref.url, ref.siteName].filter((part) => part.length > 0).join(" — ");
      return `<li><a href="${escapeHtml(ref.url)}">${escapeHtml(label)}</a></li>`;
    });
    parts.push(`<p>${escapeHtml(labels.sources)}:</p><ul>${links.join("")}</ul>`);
  }
  return parts.join("\n");
}

function item(article: Article, options: FeedOptions): string {
  const labels = labelsFor(options.language);
  const title = `${article.revision > 0 ? labels.updated : ""}${article.title}`;
  const category = options.categoryNames.get(article.categoryId);
  return [
    "<item>",
    `<title>${xmlText(title)}</title>`,
    `<link>${xmlText(article.primaryUrl ?? options.link)}</link>`,
    // The revision is part of the identifier, so that readers show an updated article as a new item.
    `<guid isPermaLink="false">smarternews:${article.id}:${article.revision}</guid>`,
    `<pubDate>${new Date(article.updatedAt).toUTCString()}</pubDate>`,
    category ? `<category>${xmlText(category)}</category>` : "",
    `<description>${xmlText(article.summary)}</description>`,
    `<content:encoded>${xmlText(contentHtml(article, options))}</content:encoded>`,
    "</item>",
  ]
    .filter((line) => line.length > 0)
    .join("");
}

/** An RSS 2.0 document for the given articles, in the order given. */
export function renderRss(options: FeedOptions): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    "<channel>",
    `<title>${xmlText(options.title)}</title>`,
    `<link>${xmlText(options.link)}</link>`,
    `<description>${xmlText(options.description)}</description>`,
    `<language>${xmlText(options.language)}</language>`,
    "<generator>smarternews</generator>",
    ...options.articles.map((article) => item(article, options)),
    "</channel>",
    "</rss>",
    "",
  ].join("\n");
}
