import { useEffect } from "react";

const NAME = "SmarterNews";
/** How much of an article's title the tab shows. A tab is narrow, and the count has to stay readable. */
export const TITLE_CHARS = 30;

/** The text of the browser tab: the name, the number of unread articles, and the start of the open article's title. */
export function pageTitle(unread: number | undefined, article?: string): string {
  const count = unread === undefined ? "" : `(${unread})`;
  const start = article ? `-${Array.from(article).slice(0, TITLE_CHARS).join("")}` : "";
  return `${NAME}${count}${start}`;
}

export function usePageTitle(unread: number | undefined, article?: string): void {
  useEffect(() => {
    document.title = pageTitle(unread, article);
  }, [unread, article]);
}
