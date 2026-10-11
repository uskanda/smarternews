import type { TranslationItem, Translator } from "../translation/adapter.ts";

/**
 * A stand-in for the translation API. Every item is answered by the test function; what was asked is
 * recorded, so a test can see what would have left the server.
 */
export function fakeTranslator(answer: (item: TranslationItem, target: string) => string = (item) => `訳:${item.text}`, sourceLanguage: string | null = "en") {
  const calls: Array<{ items: TranslationItem[]; target: string }> = [];
  const translator: Translator & { calls: typeof calls } = {
    calls,
    async translate(items, target) {
      calls.push({ items, target });
      return { texts: items.map((item) => answer(item, target)), sourceLanguage };
    },
  };
  return translator;
}
