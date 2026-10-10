const KEY = "smarternews.token";

// Storage can be unavailable (a private window, blocked site data). The app then asks for the token again
// on each visit instead of failing.
export function readToken(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeToken(token: string | null): void {
  try {
    if (token === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, token);
  } catch {
    // nothing to do: the token lives for this page only
  }
}
