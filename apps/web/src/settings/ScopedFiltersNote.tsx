import { useScopedFilterCount } from "../api/queries.ts";

/**
 * In the confirmation of deleting a feed or a category: the filters whose scope it is go with it. Says
 * nothing when there are none, or until the filters have arrived.
 */
export function ScopedFiltersNote({ target }: { target: { feedId: number } | { categoryId: number } }) {
  const count = useScopedFilterCount(target);
  if (!count) return null;
  return <p>この{"feedId" in target ? "購読フィード" : "カテゴリ"}を範囲とするフィルター{count}件も一緒に削除されます。</p>;
}
