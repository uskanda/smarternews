import * as Dialog from "@radix-ui/react-dialog";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Button } from "./controls.tsx";
import { UnsavedContext, useUnsavedParts } from "./unsaved.tsx";

const PANEL = "fixed top-1/2 left-1/2 z-50 flex max-h-[90dvh] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-lg border border-outline bg-surface p-xl";
/** The sizes of the panel: a form, the tighter dialogs of the article's annotations, and a form as wide as the article. */
const LAYOUT = {
  form: "w-[min(90vw,var(--spacing-list))] gap-lg",
  compact: "w-[min(90vw,var(--spacing-list))] gap-md",
  article: "w-[min(90vw,var(--spacing-measure-article))] gap-md",
} as const;

/** Closing the dialog as its cancel button does: asking first while a field below it holds input. */
const CancelContext = createContext<(() => void) | null>(null);

/**
 * What a cancel button inside a form calls: in a `FormDialog`, closing it after asking while a field holds input;
 * elsewhere, as on a settings page, `fallback` as it is.
 */
export function useDialogCancel(fallback: () => void): () => void {
  return useContext(CancelContext) ?? fallback;
}

/** A button that closes the `FormDialog` it is in, as Escape does: asking first while a field holds input. */
export function DialogCloseButton({ children }: { children: ReactNode }) {
  return (
    <Dialog.Close asChild>
      <Button>{children}</Button>
    </Dialog.Close>
  );
}

/**
 * A dialog that holds a form over the page: its fields take the keys, so the one-letter keys of the lists stay off
 * while it is open. It scrolls on its own when the form grows taller than the window. The first field takes the
 * focus when it opens, and `trigger`, the button that opens it, or `returnFocus` takes the focus back when it closes.
 *
 * The parts below it tell it what they hold with `useUnsaved`, input or an answer being waited for. While one does,
 * pressing outside leaves it open, and Escape, a close button and `useDialogCancel` ask before throwing the input
 * away. Closing it from the parent, as once a form is saved, never asks.
 */
export function FormDialog({
  open,
  onOpenChange,
  trigger,
  title,
  layout = "form",
  returnFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Left out when what opens the dialog is elsewhere, as an entry of a menu. */
  trigger?: ReactNode;
  title: string;
  layout?: keyof typeof LAYOUT;
  /** Where the focus goes when it closes, in place of the trigger. */
  returnFocus?: () => HTMLElement | null;
  children: ReactNode;
}) {
  const { parts, mark } = useUnsavedParts();
  const dirty = parts.size > 0;
  const [asking, setAsking] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const unsaved = useMemo(() => ({ mark, leave: () => {} }), [mark]);

  const cancel = useCallback(() => {
    if (dirty) setAsking(true);
    else onOpenChange(false);
  }, [dirty, onOpenChange]);

  // The question closes first and the dialog after it, so that the focus goes back to what opened the dialog.
  useEffect(() => {
    if (!discarding || asking) return;
    setDiscarding(false);
    onOpenChange(false);
  }, [discarding, asking, onOpenChange]);

  return (
    <>
      <Dialog.Root open={open} onOpenChange={(next) => (next ? onOpenChange(true) : cancel())}>
        {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-on-surface/40" />
          <Dialog.Content
            data-hotkeys="off"
            aria-describedby={undefined}
            onInteractOutside={(event) => {
              if (dirty) event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              const target = returnFocus?.();
              if (target) {
                event.preventDefault();
                target.focus();
              }
            }}
            className={`${PANEL} ${LAYOUT[layout]}`}
          >
            <Dialog.Title className="type-headline-md">{title}</Dialog.Title>
            <UnsavedContext.Provider value={unsaved}>
              <CancelContext.Provider value={cancel}>{children}</CancelContext.Provider>
            </UnsavedContext.Provider>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <ConfirmDialog
        open={asking}
        title="保存していない変更があります"
        onDismiss={() => setAsking(false)}
        actions={
          <>
            <Button
              onClick={() => {
                setAsking(false);
                setDiscarding(true);
              }}
            >
              破棄して閉じる
            </Button>
            <Button variant="primary" onClick={() => setAsking(false)}>
              編集を続ける
            </Button>
          </>
        }
      >
        <p>このまま閉じると、入力した内容は保存されません：{[...parts.values()].join("、")}</p>
      </ConfirmDialog>
    </>
  );
}
