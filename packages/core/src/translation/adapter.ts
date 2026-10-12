// A way to translate: the translation API, or a model. Like the providers of the model tasks, the ways are
// interchangeable behind this one shape, and tests put a recorded one in their place.

export interface TranslationItem {
  /** Markdown of one segment, or the words alone when `plain` is set. */
  text: string;
  /** True for a text without markup, such as a title. */
  plain?: boolean;
}

export interface TranslationOutput {
  /** One translation for every item, in the same order and the same form. */
  texts: string[];
  /** The language the originals were found to be in, when the way tells. */
  sourceLanguage: string | null;
}

export interface Translator {
  /** Resolves with as many translations as items. Rejects when the way cannot be used or fails. */
  translate(items: TranslationItem[], target: string): Promise<TranslationOutput>;
}
