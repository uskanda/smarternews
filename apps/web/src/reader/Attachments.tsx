import type { Article } from "@smarternews/core/api";
import { attachmentDisplays, relayedImageUrl } from "@smarternews/client";
import { ArticleImage } from "./Markdown.tsx";

const LINK = "tap break-words text-primary underline underline-offset-4";

/**
 * The files a feed attached to an article, below its body. An image is loaded from the server's relay, and the
 * thumbnail of a video is a link to the article's page. Any other file is a link to it, with its kind and size.
 * Nothing is played or embedded. An article without attachments shows nothing.
 */
export function Attachments({ article }: { article: Pick<Article, "attachments"> }) {
  const displays = attachmentDisplays(article.attachments);
  if (displays.length === 0) return null;
  return (
    <section aria-label="添付" className="flex flex-col gap-sm border-t border-outline pt-lg">
      <h3 className="type-label-sm text-on-surface-muted">添付</h3>
      <ul className="attachment-list flex flex-col gap-md type-body-md">
        {displays.map((display) => (
          <li key={display.key} className="min-w-0">
            {display.type === "image" ? (
              display.href !== null ? (
                <a href={display.href} target="_blank" rel="noopener noreferrer" aria-label={display.linkLabel ?? undefined} className="block">
                  <ArticleImage src={relayedImageUrl("", display.src) ?? ""} alt={display.alt} />
                </a>
              ) : (
                <ArticleImage src={relayedImageUrl("", display.src) ?? ""} alt={display.alt} />
              )
            ) : (
              <>
                <a href={display.href} target="_blank" rel="noopener noreferrer" className={LINK}>
                  {display.label}
                </a>
                <span className="pl-sm text-on-surface-muted">{display.details}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
