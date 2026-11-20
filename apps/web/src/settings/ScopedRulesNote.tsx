import { useScopedRuleCount } from "../api/queries.ts";

/**
 * In the confirmation of deleting a feed or a category: the rules whose scope it is go with it. Says nothing
 * when there are none, or until the rules have arrived.
 */
export function ScopedRulesNote({ target }: { target: { feedId: number } | { categoryId: number } }) {
  const count = useScopedRuleCount(target);
  if (!count) return null;
  return <p>この{"feedId" in target ? "購読フィード" : "カテゴリ"}を範囲とするルール{count}件も一緒に削除されます。</p>;
}
