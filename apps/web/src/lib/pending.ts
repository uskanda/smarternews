import { useCallback, useRef, useState } from "react";

/**
 * Whether a request the user started is still waiting for its answer, and the way to start one. While one waits,
 * starting another does nothing, so that a second press, key or menu item cannot send the same change twice.
 * The check reads a ref, so even two calls in the same render send one request; the state is for the buttons.
 *
 *     const [pending, run] = usePending();
 *     <Button disabled={pending} onClick={() => void run(remove)}>削除する</Button>
 */
export function usePending(): [pending: boolean, run: (task: () => Promise<unknown>) => Promise<void>] {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const run = useCallback(async (task: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      await task();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, []);
  return [pending, run];
}
