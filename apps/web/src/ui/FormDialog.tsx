import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

/**
 * A dialog that holds a form over the page: its fields take the keys, so the one-letter keys of the lists stay off
 * while it is open. It scrolls on its own when the form grows taller than the window. The first field takes the
 * focus when it opens, and `trigger`, the button that opens it, takes the focus back when it closes.
 */
export function FormDialog({
  open,
  onOpenChange,
  trigger,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Left out when what opens the dialog is elsewhere, as an entry of a menu. */
  trigger?: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-on-surface/40" />
        <Dialog.Content
          data-hotkeys="off"
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[90dvh] w-[min(90vw,var(--spacing-list))] -translate-x-1/2 -translate-y-1/2 flex-col gap-lg overflow-y-auto rounded-lg border border-outline bg-surface p-xl"
        >
          <Dialog.Title className="type-headline-md">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
