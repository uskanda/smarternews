import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "react-router";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { Button } from "../ui/controls.tsx";

// What a settings page holds that is not saved yet, gathered from its parts, so that one question covers the page.
// React Router keeps one blocker at a time, so each page has one guard, and the parts only say what they hold.

interface Unsaved {
  /** Marks the part `id` as holding changes under `label`, or as holding none when `label` is null. */
  mark: (id: string, label: string | null) => void;
  /** Lets the next move go without a question: what was being edited is gone, or was just saved. */
  leave: () => void;
}

const UnsavedContext = createContext<Unsaved | null>(null);

/** Asks before the page is left while a part below it holds changes, and has the browser ask before a reload. */
export function UnsavedGuard({ children }: { children: ReactNode }) {
  const [parts, setParts] = useState<ReadonlyMap<string, string>>(new Map());
  const leaving = useRef(false);
  // Moving within the page, such as to a section by its hash, loses nothing.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => parts.size > 0 && !leaving.current && currentLocation.pathname !== nextLocation.pathname);
  const dirty = parts.size > 0;

  useEffect(() => {
    if (!dirty) return;
    // The browser shows its own words; the page only asks it to confirm.
    const confirm = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", confirm);
    return () => window.removeEventListener("beforeunload", confirm);
  }, [dirty]);

  const mark = useCallback((id: string, label: string | null) => {
    setParts((current) => {
      if (label === null ? !current.has(id) : current.get(id) === label) return current;
      const next = new Map(current);
      if (label === null) next.delete(id);
      else next.set(id, label);
      return next;
    });
  }, []);
  const leave = useCallback(() => {
    leaving.current = true;
  }, []);
  const value = useMemo(() => ({ mark, leave }), [mark, leave]);

  return (
    <UnsavedContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={blocker.state === "blocked"}
        title="保存していない変更があります"
        onDismiss={() => blocker.reset?.()}
        actions={
          <>
            <Button onClick={() => blocker.proceed?.()}>破棄して移動</Button>
            <Button variant="primary" onClick={() => blocker.reset?.()}>
              編集を続ける
            </Button>
          </>
        }
      >
        <p>このまま移動すると、次の変更は保存されません：{[...parts.values()].join("、")}</p>
      </ConfirmDialog>
    </UnsavedContext.Provider>
  );
}

/**
 * Tells the page's guard that this part holds changes while `dirty`, named `label` in the question.
 * Outside a guard, such as in a dialog over the list of articles, it does nothing.
 */
export function useUnsaved(label: string, dirty: boolean): void {
  const unsaved = useContext(UnsavedContext);
  const id = useId();
  useEffect(() => {
    if (!unsaved || !dirty) return;
    unsaved.mark(id, label);
    return () => unsaved.mark(id, null);
  }, [unsaved, id, label, dirty]);
}

/** Lets the next move leave the page without the question, after the thing being edited is deleted or created. */
export function useUnsavedLeaving(): () => void {
  const unsaved = useContext(UnsavedContext);
  return useMemo(() => unsaved?.leave ?? (() => {}), [unsaved]);
}
