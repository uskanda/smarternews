import type { Category } from "@smarternews/core/api";
import { useState } from "react";
import { AddFeedForm } from "../settings/AddFeedForm.tsx";
import { Button } from "../ui/controls.tsx";
import { FormDialog } from "../ui/FormDialog.tsx";

/**
 * The button above the list of a news category, of feeds or of uncategorized feeds, and the dialog it opens: the
 * fields of the page of feeds, starting in `category`, or in none without it. The list stays where it is behind it,
 * and a new dialog starts empty.
 */
export function AddFeedDialog({ categories, category }: { categories: Category[]; category?: Category }) {
  const [open, setOpen] = useState(false);
  return (
    <FormDialog open={open} onOpenChange={setOpen} trigger={<Button>購読フィードを追加</Button>} title="購読フィードを追加">
      <AddFeedForm categories={categories} categoryId={category?.id ?? null} onAdded={() => setOpen(false)} />
      <div className="flex justify-end">
        <Button onClick={() => setOpen(false)}>閉じる</Button>
      </div>
    </FormDialog>
  );
}
