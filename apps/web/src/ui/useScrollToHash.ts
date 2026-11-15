import { useEffect } from "react";
import { useLocation } from "react-router";

/**
 * Scrolls to the element the address names after the `#`, such as /settings#providers from the warning at the top
 * of the screen. It waits until `ready`, for an element that only appears once what the page loads is in.
 *
 * The focus then goes to the first heading of that element, so that the next Tab goes on from there rather than
 * from the link that was chosen. The heading needs `tabIndex={-1}` to take it.
 */
export function useScrollToHash(ready: boolean) {
  const { hash, key } = useLocation();
  useEffect(() => {
    if (!ready || hash.length < 2) return;
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!target) return;
    target.scrollIntoView?.({ block: "start" });
    // Without preventScroll, the browser would move the page again to show the heading as it sees fit.
    target.querySelector<HTMLElement>("h1, h2, h3, h4, h5, h6")?.focus({ preventScroll: true });
    // The key makes a second choice of the same link scroll again.
  }, [hash, key, ready]);
}
