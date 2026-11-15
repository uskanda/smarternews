import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "../ui/controls.tsx";

const DAY = 86_400_000;

/** The periods the menu offers, and the name of each where it says that nothing is that old. */
export const MARK_OLDER_PERIODS = [
  { label: "1日", ms: DAY },
  { label: "3日", ms: 3 * DAY },
  { label: "1週間", ms: 7 * DAY },
] as const;
export type MarkOlderPeriod = (typeof MARK_OLDER_PERIODS)[number];

const NAME = "期間を選んで既読にする";

// Looks like the menu of an entry in the left pane (DESIGN.md), as the menu of the order does. It opens to the
// left, from the right edge of the button: the button is at the right edge of the list's header.
const MENU = "absolute right-0 top-full z-50 mt-xs min-w-48 rounded-md border border-outline-strong bg-surface p-xs type-body-md text-on-surface";
const MENU_ITEM =
  "tap flex w-full cursor-default items-center rounded-sm px-md py-xs text-left outline-none hover:bg-selected focus:bg-selected focus:outline-2 focus:-outline-offset-2 focus:outline-primary";

/**
 * Marking read what is older than a period: a narrow button beside "mark all as read", and a menu of the
 * periods. The keyboard opens it with Enter, Space or the down arrow on the button, moves with the arrows,
 * chooses with Enter or Space, and leaves with Escape.
 */
export function MarkOlderMenu({ onChoose }: { onChoose: (period: MarkOlderPeriod) => void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const choose = (period: MarkOlderPeriod) => {
    close();
    onChoose(period);
  };
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step !== 0) {
      event.preventDefault();
      items[(at + step + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      close();
    }
    // Keys the menu answers are not the reader's shortcuts.
    event.stopPropagation();
  };

  return (
    <span className="relative inline-flex">
      <Button
        ref={button}
        aria-label={NAME}
        title={NAME}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        // Joined to the right edge of "mark all as read", so that the two read as one action.
        className="-ml-px rounded-l-none! px-sm!"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <span aria-hidden="true">▾</span>
      </Button>
      {open ? (
        <div ref={menu} id={menuId} role="menu" aria-label={NAME} className={MENU} onKeyDown={onMenuKey}>
          {MARK_OLDER_PERIODS.map((period) => (
            <button key={period.label} type="button" role="menuitem" tabIndex={-1} className={MENU_ITEM} onClick={() => choose(period)}>
              {period.label}より古い記事
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
