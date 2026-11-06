import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useHotkeys } from "../lib/keys.ts";
import { Button } from "../ui/controls.tsx";

export interface Toast {
  message: string;
  /** One follow-up the user may take while the message is shown, such as undoing what just happened. */
  action?: { label: string; run: () => void };
  durationMs?: number;
}

const ToastContext = createContext<(toast: Toast) => void>(() => {});

export function useToast(): (toast: Toast) => void {
  return useContext(ToastContext);
}

const DEFAULT_DURATION_MS = 6000;

/**
 * Shows one short message at a time at the bottom of the screen, and announces it to screen readers. A message
 * stays while the pointer is over it or the focus is in it, and counts its time again from the start once both
 * have left. `z` runs the action of the message shown.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const holds = useRef({ pointer: false, focus: false });

  const count = useCallback((next: Toast) => {
    clearTimeout(timer.current);
    if (holds.current.pointer || holds.current.focus) return;
    timer.current = setTimeout(() => setToast(null), next.durationMs ?? DEFAULT_DURATION_MS);
  }, []);
  const show = useCallback(
    (next: Toast) => {
      setToast(next);
      count(next);
    },
    [count],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  const value = useMemo(() => show, [show]);

  function hold(kind: "pointer" | "focus", on: boolean) {
    holds.current[kind] = on;
    if (on) clearTimeout(timer.current);
    else if (toast) count(toast);
  }
  function act() {
    toast?.action?.run();
    clearTimeout(timer.current);
    holds.current = { pointer: false, focus: false };
    setToast(null);
  }

  useHotkeys({ z: toast?.action ? act : undefined });

  return (
    <ToastContext value={value}>
      {children}
      {/* The region is always there, so that a dialog opened later does not hide it from a screen reader. */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-lg z-50 flex justify-center px-lg">
        {toast ? (
          <div
            role="status"
            className="pointer-events-auto flex items-center gap-md rounded-md border border-outline bg-surface px-lg py-sm type-body-md text-on-surface"
            onMouseEnter={() => hold("pointer", true)}
            onMouseLeave={() => hold("pointer", false)}
            onFocus={() => hold("focus", true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) hold("focus", false);
            }}
          >
            <span>{toast.message}</span>
            {toast.action ? (
              <Button variant="quiet" aria-keyshortcuts="z" onClick={act}>
                {toast.action.label}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </ToastContext>
  );
}
