import { useRouter, type Href } from "expo-router";
import { useCallback } from "react";

/**
 * Goes back one screen. A screen opened from a notification or a link has nothing behind it; from there the
 * button leads to the screen it names.
 */
export function useBack(fallback: Href): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
  }, [router, fallback]);
}
