import * as Dialog from "@radix-ui/react-dialog";
import { jumpCandidates, listKey, type ListTarget, type NavModel } from "@smarternews/client";
import { useId, useMemo, useState, type KeyboardEvent } from "react";

/**
 * The input and the candidates of the dialog. It is mounted each time the dialog opens, so it starts empty
 * with the first candidate chosen.
 */
function Picker({ model, onPick }: { model: NavModel; onPick: (target: ListTarget) => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const candidates = useMemo(() => jumpCandidates(model, query), [model, query]);
  const id = useId();
  const optionId = (at: number) => `${id}-option-${at}`;
  const chosen = candidates.length === 0 ? -1 : Math.min(index, candidates.length - 1);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      // Stops at either end.
      setIndex(Math.max(0, Math.min(candidates.length - 1, chosen + step)));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      // The Enter that settles what an input method is converting opens nothing.
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      const candidate = candidates[chosen];
      if (candidate) onPick(candidate.target);
    }
  }

  return (
    <>
      <input
        type="text"
        role="combobox"
        aria-label="項目の名前"
        aria-expanded="true"
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={chosen === -1 ? undefined : optionId(chosen)}
        placeholder="名前の一部"
        autoComplete="off"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIndex(0);
        }}
        onKeyDown={onKeyDown}
        className="tap w-full min-w-0 rounded-md border border-outline-strong bg-surface px-sm py-xs type-body-md text-on-surface"
      />
      <ul id={`${id}-list`} role="listbox" aria-label="候補" className="flex max-h-[50dvh] flex-col gap-px overflow-y-auto">
        {candidates.map((candidate, at) => {
          const selected = at === chosen;
          return (
            <li
              key={listKey(candidate.target)}
              id={optionId(at)}
              role="option"
              aria-selected={selected}
              // The focus stays in the input, so that typing goes on.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(candidate.target)}
              ref={selected ? (row) => row?.scrollIntoView?.({ block: "nearest" }) : undefined}
              className={`tap flex min-w-0 cursor-pointer items-center gap-sm rounded-md px-sm py-xs type-body-md ${selected ? "bg-selected font-semibold" : ""}`}
            >
              <span className="min-w-0 truncate">{candidate.label}</span>
              {candidate.group !== null ? (
                <>
                  <span className="sr-only">、</span>
                  <span className="min-w-0 shrink-[2] truncate type-label-sm font-normal text-on-surface-muted">{candidate.group}</span>
                </>
              ) : null}
              {candidate.unread > 0 ? (
                <>
                  <span className="sr-only">、未読</span>
                  <span className="ml-auto tabular-nums text-on-surface-muted">{candidate.unread}</span>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
      {candidates.length === 0 ? <p className="px-sm type-body-md text-on-surface-muted">当てはまる項目はありません。</p> : null}
    </>
  );
}

/**
 * The dialog `g u` opens: type part of a name, and Enter opens that category or feed. `model` is the one
 * before hiding, so that folded and hidden entries can be reached. `onCloseAutoFocus` decides where the focus
 * goes once it closes.
 */
export function JumpDialog({
  open,
  onOpenChange,
  model,
  onPick,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: NavModel;
  onPick: (target: ListTarget) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-on-surface/40" />
        <Dialog.Content
          // One-letter keys typed here never reach the list behind.
          data-hotkeys="off"
          onCloseAutoFocus={onCloseAutoFocus}
          className="fixed top-[15dvh] left-1/2 z-50 flex w-[min(90vw,var(--spacing-list))] -translate-x-1/2 flex-col gap-sm rounded-lg border border-outline bg-surface p-lg"
        >
          <Dialog.Title className="type-headline-md">項目へ移る</Dialog.Title>
          <Dialog.Description className="type-label-sm text-on-surface-muted">名前の一部を打ち、Enterでカテゴリか購読フィードを開きます。</Dialog.Description>
          {open ? <Picker model={model} onPick={onPick} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
