import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

/** Shows one short message at a time at the bottom of the screen, and announces it to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((next: Toast) => {
    clearTimeout(timer.current);
    setToast(next);
    timer.current = setTimeout(() => setToast(null), next.durationMs ?? 6000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const value = useMemo(() => show, [show]);

  return (
    <ToastContext value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-lg z-50 flex justify-center px-lg">
        {toast ? (
          <div
            role="status"
            className="pointer-events-auto flex items-center gap-md rounded-md border border-outline bg-surface px-lg py-sm type-body-md text-on-surface"
          >
            <span>{toast.message}</span>
            {toast.action ? (
              <Button
                variant="quiet"
                onClick={() => {
                  toast.action!.run();
                  clearTimeout(timer.current);
                  setToast(null);
                }}
              >
                {toast.action.label}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </ToastContext>
  );
}
