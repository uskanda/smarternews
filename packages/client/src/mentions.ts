import { MENTION_KINDS, type Mention, type MentionKind } from "@smarternews/core/api";

/** The heading of each kind of name below an article's body. */
export const MENTION_KIND_LABELS: Record<MentionKind, string> = { person: "人", organization: "組織", product: "製品", place: "地名" };

export interface MentionGroup {
  kind: MentionKind;
  label: string;
  mentions: Mention[];
}

/**
 * The names of an article by kind: people, organizations, products, places, each kind in the order the names
 * were stored. A kind without names has no group, and an article without names none at all.
 */
export function groupMentions(mentions: Mention[]): MentionGroup[] {
  return MENTION_KINDS.map((kind) => ({ kind, label: MENTION_KIND_LABELS[kind], mentions: mentions.filter((mention) => mention.kind === kind) })).filter(
    (group) => group.mentions.length > 0,
  );
}
