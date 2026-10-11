import * as Dialog from "@radix-ui/react-dialog";
import { useRef, type ReactNode } from "react";

/** A question the user must answer before something that cannot be undone, or before losing their edits. */
export function ConfirmDialog({
  open,
  title,
  children,
  actions,
  onDismiss,
  returnFocus,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  /** Buttons, safest choice last so that it sits where the dialog is dismissed. */
  actions: ReactNode;
  onDismiss: () => void;
  /** Where the focus goes when the dialog closes, when what opened it is gone by then: a menu item, a deleted row. */
  returnFocus?: () => HTMLElement | null | undefined;
}) {
  // The dialog is opened by a button that is not a Radix trigger, so where the focus was is remembered here.
  const opener = useRef<HTMLElement | null>(null);
  const actionRow = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : onDismiss())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-on-surface/40" />
        <Dialog.Content
          role="alertdialog"
          onOpenAutoFocus={(event) => {
            opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            // The last button is the safest choice: a second Enter must not confirm something that cannot be undone.
            const buttons = actionRow.current?.querySelectorAll("button");
            const safest = buttons?.[buttons.length - 1];
            if (safest) {
              event.preventDefault();
              safest.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            const target = returnFocus?.() ?? (opener.current?.isConnected ? opener.current : null);
            if (target) {
              event.preventDefault();
              target.focus();
            }
          }}
          className="fixed top-1/2 left-1/2 z-50 flex w-[min(90vw,var(--spacing-list))] -translate-x-1/2 -translate-y-1/2 flex-col gap-md rounded-lg border border-outline bg-surface p-xl"
        >
          <Dialog.Title className="type-headline-md">{title}</Dialog.Title>
          <Dialog.Description asChild>
            <div className="flex flex-col gap-sm type-body-md">{children}</div>
          </Dialog.Description>
          <div ref={actionRow} className="flex flex-wrap justify-end gap-sm pt-sm">{actions}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
