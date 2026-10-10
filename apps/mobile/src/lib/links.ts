import * as WebBrowser from "expo-web-browser";

/** True for the links the app opens: web pages. Anything else, such as `javascript:` or `file:`, is not opened. */
export function isWebLink(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

/** Opens a source in the in-app browser, so that closing it returns to the article. */
export async function openSource(url: string): Promise<void> {
  if (!isWebLink(url)) return;
  await WebBrowser.openBrowserAsync(url.trim());
}
