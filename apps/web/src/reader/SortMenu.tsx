import type { ListSort } from "@smarternews/core/api";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "../ui/controls.tsx";

const LABELS: Record<ListSort, string> = { newest: "新しい順", oldest: "古い順" };
const OPTIONS: ListSort[] = ["newest", "oldest"];

// Looks like the menu of an entry in the left pane (DESIGN.md): surface, outline-strong, rounded md, no shadow.
const MENU = "absolute left-0 top-full z-50 mt-xs min-w-40 rounded-md border border-outline-strong bg-surface p-xs type-body-md text-on-surface";
const MENU_ITEM =
  "tap flex w-full cursor-default items-center gap-sm rounded-sm px-md py-xs text-left outline-none hover:bg-selected focus:bg-selected focus:outline-2 focus:-outline-offset-2 focus:outline-primary";

/**
 * The order of the list: a button that names the order in use, and a menu of the two orders. The keyboard
 * opens it with Enter, Space or the down arrow on the button, moves with the arrows, chooses with Enter or
 * Space, and leaves with Escape.
 */
export function SortMenu({ sort, onChange }: { sort: ListSort; onChange: (sort: ListSort) => void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
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
  const choose = (next: ListSort) => {
    close();
    if (next !== sort) onChange(next);
  };
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
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
        aria-label={`並び順：${LABELS[sort]}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        並び順：{LABELS[sort]}
      </Button>
      {open ? (
        <div ref={menu} id={menuId} role="menu" aria-label="並び順" className={MENU} onKeyDown={onMenuKey}>
          {OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option === sort}
              tabIndex={-1}
              className={MENU_ITEM}
              onClick={() => choose(option)}
            >
              <span aria-hidden="true" className="inline-block w-lg">
                {option === sort ? "✓" : ""}
              </span>
              {LABELS[option]}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
