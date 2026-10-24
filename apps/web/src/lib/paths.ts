import type { ListTarget } from "@smarternews/client";

/** The path of a list. A category is named by its slug, so the path of a category needs the categories. */
export function listPathOf(target: ListTarget, slugOf: (categoryId: number) => string | undefined): string | null {
  switch (target.type) {
    case "category": {
      const slug = slugOf(target.categoryId);
      if (slug === undefined) return null;
      return target.generatedOnly ? `/c/${slug}/generated` : `/c/${slug}`;
    }
    case "feed":
      return `/f/${target.feedId}`;
    case "recentlyRead":
      return "/recently-read";
    default:
      return `/${target.type}`;
  }
}

/** True on the list itself and on an article opened from it, but not on a list below it. */
export function isOnList(listPath: string, pathname: string): boolean {
  if (pathname === listPath) return true;
  return pathname.startsWith(`${listPath}/`) && /^\d+$/.test(pathname.slice(listPath.length + 1));
}
