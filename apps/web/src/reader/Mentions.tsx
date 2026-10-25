import type { Article } from "@smarternews/core/api";
import { groupMentions } from "@smarternews/client";
import { Link } from "react-router";

/** Where a name leads: the list of the articles of that name, with the article it was chosen in still open. */
export function mentionPath(articleId: number, name: string): string {
  return `/mentions/${articleId}?${new URLSearchParams({ name }).toString()}`;
}

/**
 * The names found in an article, below its body: by kind, people first, each a link to the list of the articles
 * of that name. The names come from a model that read other sites, so they are drawn as plain text, never as markup.
 * An article without names shows nothing.
 */
export function Mentions({ article }: { article: Pick<Article, "id" | "mentions"> }) {
  const groups = groupMentions(article.mentions);
  if (groups.length === 0) return null;
  return (
    <section aria-label="記事に出てくる名前" className="flex flex-col gap-md border-t border-outline pt-lg">
      {groups.map((group) => (
        <div key={group.kind} className="flex flex-col gap-xs">
          <h3 className="type-label-sm text-on-surface-muted">{group.label}</h3>
          <ul className="flex flex-wrap gap-xs">
            {group.mentions.map((mention) => (
              <li key={mention.name} className="min-w-0">
                <Link to={mentionPath(article.id, mention.name)} className="tap mention-link">
                  {mention.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
