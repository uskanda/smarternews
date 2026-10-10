import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

/** A question the user must answer before something that cannot be undone, or before losing their edits. */
export function ConfirmDialog({
  open,
  title,
  children,
  actions,
  onDismiss,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  /** Buttons, safest choice last so that it sits where the dialog is dismissed. */
  actions: ReactNode;
  onDismiss: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : onDismiss())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-on-surface/40" />
        <Dialog.Content
          role="alertdialog"
          className="fixed top-1/2 left-1/2 z-50 flex w-[min(90vw,var(--spacing-list))] -translate-x-1/2 -translate-y-1/2 flex-col gap-md rounded-lg border border-outline bg-surface p-xl"
        >
          <Dialog.Title className="type-headline-md">{title}</Dialog.Title>
          <Dialog.Description asChild>
            <div className="flex flex-col gap-sm type-body-md">{children}</div>
          </Dialog.Description>
          <div className="flex flex-wrap justify-end gap-sm pt-sm">{actions}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
