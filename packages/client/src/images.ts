import { isImageProxyPath } from "@smarternews/core/api";

/**
 * The address a screen loads an image of an article from: a path of the server's relay, resolved against the
 * server's URL. Null for any other image, which a screen shows as its description and never loads.
 */
export function relayedImageUrl(serverUrl: string, src: string): string | null {
  if (!isImageProxyPath(src)) return null;
  return `${serverUrl.replace(/\/+$/, "")}${src}`;
}
