// Mentions: the names of people, organizations, products and places that the write task and the summarize task
// find in an article. Pure functions without Node imports: the API schemas and the apps load them.
import { z } from "zod";
import { charCount, normalizeForMatch } from "./search/text.ts";

/** The kinds of names, in the order a screen lists them. */
export const MENTION_KINDS = ["person", "organization", "product", "place"] as const;
export const mentionKindSchema = z.enum(MENTION_KINDS);
export type MentionKind = z.infer<typeof mentionKindSchema>;

/** One article keeps at most this many names. */
export const MAX_MENTIONS = 10;
/** The longest name, in characters, without the spaces around it. */
export const MAX_MENTION_NAME_CHARS = 100;

export const mentionSchema = z.object({ name: z.string(), kind: mentionKindSchema });
export type Mention = z.infer<typeof mentionSchema>;

/**
 * The form in which names are compared: case and width alike, as search and filters compare texts, without
 * the spaces around it and with a run of spaces made one. Nothing else: an abbreviation stays another name.
 */
export function mentionKey(name: string): string {
  return normalizeForMatch(name).trim().replaceAll(/\s+/gu, " ");
}

const rawMentionsSchema = z.array(
  z.object({
    name: z
      .string()
      .trim()
      .refine((name) => name.length > 0 && charCount(name) <= MAX_MENTION_NAME_CHARS),
    kind: mentionKindSchema,
  }),
);

/**
 * The names of a task's output, or null when they are not a list of names of the four kinds, each with a name
 * of 1 to 100 characters. Of names that are the same, the first is kept; of what remains, the first ten.
 */
export function parseMentions(raw: unknown): Mention[] | null {
  const parsed = rawMentionsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const seen = new Set<string>();
  const mentions: Mention[] = [];
  for (const mention of parsed.data) {
    const key = mentionKey(mention.name);
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push({ name: mention.name, kind: mention.kind });
    if (mentions.length === MAX_MENTIONS) break;
  }
  return mentions;
}
