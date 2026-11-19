import { FORMAT_LABELS, FORMAT_OPTIONS, SORT_LABELS } from "@smarternews/client";
import type { ListFormat, ListSort } from "@smarternews/core/api";
import { ChoiceMenu } from "./ChoiceMenu.tsx";

/** The order of the list: a button that names the order in use, and a menu of the orders the list offers. */
export function SortMenu({ sort, options, onChange }: { sort: ListSort; options: readonly ListSort[]; onChange: (sort: ListSort) => void }) {
  return <ChoiceMenu name="並び順" value={sort} options={options} labels={SORT_LABELS} onChange={onChange} />;
}

/** The format of the list: a button that names the format in use, and a menu of the three formats. */
export function FormatMenu({ format, onChange }: { format: ListFormat; onChange: (format: ListFormat) => void }) {
  return <ChoiceMenu name="表示" value={format} options={FORMAT_OPTIONS} labels={FORMAT_LABELS} onChange={onChange} />;
}
