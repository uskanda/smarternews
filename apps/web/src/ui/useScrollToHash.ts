import { useEffect } from "react";
import { useLocation } from "react-router";

/**
 * Scrolls to the element the address names after the `#`, such as /settings#providers from the warning at the top
 * of the screen. It waits until `ready`, for an element that only appears once what the page loads is in.
 */
export function useScrollToHash(ready: boolean) {
  const { hash, key } = useLocation();
  useEffect(() => {
    if (!ready || hash.length < 2) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView?.({ block: "start" });
    // The key makes a second choice of the same link scroll again.
  }, [hash, key, ready]);
}
