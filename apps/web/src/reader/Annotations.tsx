import * as Dialog from "@radix-ui/react-dialog";
import { anchorOf, locateHighlights, PART_SEPARATOR, partStarts, rangesByPart, type HighlightAnchor, type LocatedHighlights } from "@smarternews/client";
import type { Article, Highlight } from "@smarternews/core/api";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useAnnotationActions } from "../api/queries.ts";
import { useHotkeys } from "../lib/keys.ts";
import { useToast } from "../shell/toast.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { Button } from "../ui/controls.tsx";
import { ANNOTATION_MARK, SKIP_ATTRIBUTE, type AnnotationMarks } from "./highlight.tsx";

// The reader's annotations in the article pane: highlights on the body, the menu of a selection, the dialog of a
// highlight, the highlights the body no longer holds, and the note on the whole article. Highlights are found
// in the text of the original as it is drawn, by `locateHighlights`; nothing here calls a model.

/** What a rendered original carries: the number of its part of the body. A selection must lie inside one. */
export const SEGMENT_ATTRIBUTE = "data-annotation-segment";
const isSkipped = (node: Node): boolean => (node instanceof Element ? node : node.parentElement)?.closest(`[${SKIP_ATTRIBUTE}]`) != null;

/**
 * Where a boundary of a selection is in the text of the part of the body it is in: the characters of the text
 * nodes before it, without those of a skipped element. Null for a boundary in a skipped element.
 */
export function offsetIn(segment: Element, container: Node, offset: number): number | null {
  if (isSkipped(container)) return null;
  const before = document.createRange();
  before.setStart(segment, 0);
  before.setEnd(container, offset);
  const walker = document.createTreeWalker(segment, NodeFilter.SHOW_TEXT);
  let total = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = (node as Text).length;
    if (node === container) return total + offset;
    if (before.comparePoint(node, length) > 0) break;
    if (!isSkipped(node)) total += length;
  }
  return total;
}

/** The part of the body a node is in, within `root`. */
function segmentOf(root: Element, node: Node): Element | null {
  const element = (node instanceof Element ? node : node.parentElement)?.closest(`[${SEGMENT_ATTRIBUTE}]`) ?? null;
  return element && root.contains(element) ? element : null;
}

/**
 * The highlights of a body drawn in `count` parts. Each part tells the text of its tree once it is drawn; when
 * every part has, and there are highlights, they are found in the text the parts make together, and the body is
 * drawn again with their marks. Without highlights the text is only kept, for a selection to be measured in.
 */
export function useBodyAnnotations(highlights: readonly Highlight[], count: number, enabled: boolean) {
  const texts = useRef<string[]>([]);
  const known = useRef<string[] | null>(null);
  const [shown, setShown] = useState<string[] | null>(null);
  const wanted = enabled && highlights.length > 0;
  const tell = useCallback(
    (index: number, text: string) => {
      texts.current[index] = text;
      if (!wanted) return;
      const all = texts.current.slice(0, count);
      if (all.length < count || all.some((part) => part === undefined)) return;
      if (known.current && known.current.length === all.length && known.current.every((part, at) => part === all[at])) return;
      known.current = all;
      setShown(all);
    },
    [wanted, count],
  );
  const located = useMemo(
    () => (wanted && shown && shown.length === count ? locateHighlights(shown.join(PART_SEPARATOR), highlights) : null),
    [wanted, shown, count, highlights],
  );
  const bySegment = useMemo(() => (located && shown ? rangesByPart(located, shown) : null), [located, shown]);
  const marksFor = (index: number): AnnotationMarks | undefined =>
    enabled ? { ranges: bySegment?.[index] ?? [], onText: (text: string) => tell(index, text) } : undefined;
  /** The text of the parts as drawn now, and where each starts in it. */
  const current = () => {
    const parts = texts.current.slice(0, count).map((part) => part ?? "");
    return { text: parts.join(PART_SEPARATOR), starts: partStarts(parts) };
  };
  return { marksFor, located, current };
}

/** What a selection in the body would make: its anchor, and where it is on the screen. */
interface Selected {
  anchor: HighlightAnchor;
  rect: { top: number; bottom: number; left: number };
}

/**
 * The selection inside the original parts of the body under `root`, as an anchor in their text. Null when
 * nothing is selected, when the selection reaches outside the originals or into a skipped element, and when it
 * overlaps a highlight that is shown.
 */
function selectionIn(root: Element, body: { text: string; starts: number[] }, ranges: LocatedHighlights<Highlight>["ranges"]): Selected | null {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const first = segmentOf(root, range.startContainer);
  const last = segmentOf(root, range.endContainer);
  if (!first || !last) return null;
  const startOffset = offsetIn(first, range.startContainer, range.startOffset);
  const endOffset = offsetIn(last, range.endContainer, range.endOffset);
  if (startOffset === null || endOffset === null) return null;
  const start = body.starts[Number(first.getAttribute(SEGMENT_ATTRIBUTE))]! + startOffset;
  const end = body.starts[Number(last.getAttribute(SEGMENT_ATTRIBUTE))]! + endOffset;
  if (end <= start) return null;
  const anchor = anchorOf(body.text, start, end);
  if (!anchor) return null;
  // One character never has two highlights: a selection over one offers nothing.
  const from = body.text.indexOf(anchor.quote, start);
  if (ranges.some((shown) => shown.start < from + anchor.quote.length && shown.end > from)) return null;
  // Where the selection is on the screen; a browser without the measure puts the menu at the top.
  const box = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : { top: 0, bottom: 0, left: 0 };
  return { anchor, rect: { top: box.top, bottom: box.bottom, left: box.left } };
}

/** The first mark of a highlight, which takes the focus, or its entry among those the body no longer holds. */
function placeOf(root: Element | null, id: number): HTMLElement | null {
  return (
    root?.querySelector<HTMLElement>(`mark.${ANNOTATION_MARK}[data-annotation="${id}"][tabindex]`) ??
    root?.querySelector<HTMLElement>(`[data-annotation-missing="${id}"]`) ??
    null
  );
}

const OVERLAY = "fixed inset-0 z-40 bg-on-surface/40";
const PANEL =
  "fixed top-1/2 left-1/2 z-50 flex max-h-[90dvh] w-[min(90vw,var(--spacing-list))] -translate-x-1/2 -translate-y-1/2 flex-col gap-md overflow-y-auto rounded-lg border border-outline bg-surface p-xl";
const TEXTAREA = "w-full rounded-md border border-outline-strong bg-surface px-sm py-xs type-body-md text-on-surface";

/** A note being written: a field and the buttons to save it or not. The note is kept as it is written. */
function NoteForm({ label, initial, onSave, onCancel, saving }: { label: string; initial: string; onSave: (text: string) => void; onCancel: () => void; saving: boolean }) {
  const [draft, setDraft] = useState(initial);
  const id = useId();
  return (
    <form
      className="flex flex-col gap-sm"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <label htmlFor={id} className="type-label-md">
        {label}
      </label>
      <textarea id={id} rows={4} maxLength={5000} value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus className={TEXTAREA} />
      <div className="flex flex-wrap justify-end gap-sm">
        <Button type="submit" variant="primary" disabled={saving}>
          保存
        </Button>
        <Button onClick={onCancel}>やめる</Button>
      </div>
    </form>
  );
}

/** The quote of a highlight, set apart as a quotation. Its characters are shown as written. */
function Quote({ children }: { children: string }) {
  return <blockquote className="annotation-quote break-words whitespace-pre-wrap type-body-md">{children}</blockquote>;
}

/**
 * What a highlight offers when it is pressed: its quote and note, writing or rewriting the note, and removing
 * it. When it closes, the focus goes back to the highlight.
 */
function HighlightDialog({
  highlight,
  onClose,
  onRemove,
  returnFocus,
}: {
  highlight: Highlight;
  onClose: () => void;
  onRemove: (highlight: Highlight) => void;
  returnFocus: () => HTMLElement | null;
}) {
  const actions = useAnnotationActions();
  const toast = useToast();
  const [writing, setWriting] = useState(false);
  const [saving, setSaving] = useState(false);
  async function save(text: string) {
    setSaving(true);
    try {
      await actions.updateHighlight(highlight, text);
      onClose();
    } catch {
      toast({ message: "メモを保存できませんでした。もう一度試してください。" });
    }
    setSaving(false);
  }
  return (
    <Dialog.Root open onOpenChange={(open) => (open ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            const target = returnFocus();
            if (target) {
              event.preventDefault();
              target.focus();
            }
          }}
          className={PANEL}
        >
          <Dialog.Title className="type-headline-md">ハイライト</Dialog.Title>
          <Quote>{highlight.quote}</Quote>
          {writing ? (
            <NoteForm label="メモ" initial={highlight.note ?? ""} onSave={(text) => void save(text)} onCancel={() => setWriting(false)} saving={saving} />
          ) : (
            <>
              {highlight.note !== null ? (
                <section aria-label="メモ" className="flex flex-col gap-xs">
                  <h3 className="type-label-sm text-on-surface-muted">メモ</h3>
                  <p className="break-words whitespace-pre-wrap type-body-md">{highlight.note}</p>
                </section>
              ) : null}
              <div className="flex flex-wrap justify-end gap-sm">
                <Button onClick={() => setWriting(true)}>{highlight.note !== null ? "メモを書き直す" : "メモを書く"}</Button>
                <Button onClick={() => onRemove(highlight)}>ハイライトを消す</Button>
                <Dialog.Close asChild>
                  <Button>閉じる</Button>
                </Dialog.Close>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Writing the note of a new highlight, from the menu of a selection. */
function NewHighlightDialog({ quote, onSave, onClose }: { quote: string; onSave: (note: string) => Promise<void>; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  return (
    <Dialog.Root open onOpenChange={(open) => (open ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content aria-describedby={undefined} className={PANEL}>
          <Dialog.Title className="type-headline-md">メモを書いてハイライトする</Dialog.Title>
          <Quote>{quote}</Quote>
          <NoteForm
            label="メモ"
            initial=""
            saving={saving}
            onCancel={onClose}
            onSave={(text) => {
              setSaving(true);
              void onSave(text).finally(() => setSaving(false));
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The highlights whose quote the body no longer holds, in the order they were made, after the body. Each one
 * opens the same dialog as a highlight in the body. Drawn without the look of a highlight.
 */
function MissingHighlights({ highlights, onOpen }: { highlights: readonly Highlight[]; onOpen: (highlight: Highlight) => void }) {
  if (highlights.length === 0) return null;
  return (
    <section aria-label="元の本文にあった箇所" className="flex flex-col gap-sm">
      <h3 className="type-label-sm text-on-surface-muted">元の本文にあった箇所</h3>
      <ul className="flex flex-col gap-md">
        {highlights.map((highlight) => (
          <li key={highlight.id} className="flex flex-col gap-xs">
            <button
              type="button"
              data-annotation-missing={highlight.id}
              aria-label={`元の本文にあった箇所：${highlight.quote}`}
              onClick={() => onOpen(highlight)}
              className="cursor-pointer text-left"
            >
              <Quote>{highlight.quote}</Quote>
            </button>
            {highlight.note !== null ? <p className="break-words whitespace-pre-wrap type-body-md">{highlight.note}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The body of an article with the reader's highlights. `render` draws the body, giving each original part the
 * marks `marksFor` returns and the attribute `SEGMENT_ATTRIBUTE` with its number. With `enabled` false, as while
 * what the feed delivered is shown in place of the full content, nothing is marked and nothing can be selected.
 * `focusId` names a highlight to scroll to and focus, as when it was chosen in the list of annotations.
 */
export function AnnotatedBody({
  article,
  count,
  enabled,
  focusId,
  render,
}: {
  article: Article;
  count: number;
  enabled: boolean;
  focusId: number | null;
  render: (marksFor: (index: number) => AnnotationMarks | undefined) => ReactNode;
}) {
  const highlights = article.annotations.highlights;
  const { marksFor, located, current } = useBodyAnnotations(highlights, count, enabled);
  const actions = useAnnotationActions();
  const toast = useToast();
  const root = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [writingFor, setWritingFor] = useState<HighlightAnchor | null>(null);
  const [opened, setOpened] = useState<number | null>(null);
  const [removing, setRemoving] = useState<Highlight | null>(null);
  // Where the focus goes back to once a dialog closes: the highlight, or the body when the highlight is gone.
  const returnTo = useRef<number | null>(null);

  const ranges = useMemo(() => located?.ranges ?? [], [located]);
  const missing = located?.missing ?? [];

  useEffect(() => {
    if (!enabled) {
      setSelected(null);
      return;
    }
    const look = () => setSelected(root.current ? selectionIn(root.current, current(), ranges) : null);
    document.addEventListener("selectionchange", look);
    return () => document.removeEventListener("selectionchange", look);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `current` reads the texts kept in a ref
  }, [enabled, ranges]);

  async function add(anchor: HighlightAnchor, note: string | null) {
    try {
      const made = await actions.addHighlight(article.id, { ...anchor, note });
      document.getSelection()?.removeAllRanges();
      setSelected(null);
      return made;
    } catch {
      toast({ message: "ハイライトを保存できませんでした。もう一度試してください。" });
      return null;
    }
  }

  async function remove(highlight: Highlight) {
    try {
      await actions.deleteHighlight(highlight);
      returnTo.current = null;
    } catch {
      toast({ message: "ハイライトを消せませんでした。もう一度試してください。" });
    }
  }

  useHotkeys({ h: selected ? () => void add(selected.anchor, null) : undefined });

  // From the list of annotations: the highlight is brought into view and focused, once it is drawn.
  const focused = useRef<number | null>(null);
  const settled = highlights.length === 0 || located !== null;
  useLayoutEffect(() => {
    if (focusId === null || focused.current === focusId || !settled) return;
    const place = placeOf(root.current, focusId);
    if (!place) return;
    focused.current = focusId;
    place.scrollIntoView?.({ block: "center" });
    place.focus({ preventScroll: true });
  });

  function open(target: EventTarget | null) {
    const mark = target instanceof Element ? target.closest<HTMLElement>(`mark.${ANNOTATION_MARK}[data-annotation]`) : null;
    if (!mark || !root.current?.contains(mark)) return false;
    const id = Number(mark.dataset.annotation);
    returnTo.current = id;
    setOpened(id);
    return true;
  }
  const openedHighlight = highlights.find((highlight) => highlight.id === opened);
  const focusBack = () => (returnTo.current !== null ? placeOf(root.current, returnTo.current) : null) ?? root.current;

  return (
    <>
      <div
        ref={root}
        tabIndex={-1}
        className="flex flex-col gap-lg focus:outline-none"
        onClick={(event) => {
          // A press that ends a selection is a selection, not a press of the highlight under it.
          if (document.getSelection()?.isCollapsed === false) return;
          open(event.target);
        }}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && open(event.target)) event.preventDefault();
        }}
      >
        {render(marksFor)}
        {enabled ? (
          <MissingHighlights
            highlights={missing}
            onOpen={(highlight) => {
              returnTo.current = highlight.id;
              setOpened(highlight.id);
            }}
          />
        ) : null}
      </div>
      {selected && !writingFor ? (
        <div
          role="toolbar"
          aria-label="選んだ文字列"
          className="selection-menu"
          style={{ top: `${selected.rect.bottom + 6}px`, left: `${Math.max(8, selected.rect.left)}px` }}
          // Pressing a button must not lose the selection before the button reads it.
          onMouseDown={(event) => event.preventDefault()}
        >
          <Button onClick={() => void add(selected.anchor, null)}>ハイライト</Button>
          <Button onClick={() => setWritingFor(selected.anchor)}>メモを書く</Button>
        </div>
      ) : null}
      {writingFor ? (
        <NewHighlightDialog
          quote={writingFor.quote}
          onClose={() => setWritingFor(null)}
          onSave={async (note) => {
            const made = await add(writingFor, note);
            if (made) {
              returnTo.current = made.id;
              setWritingFor(null);
            }
          }}
        />
      ) : null}
      {openedHighlight ? (
        <HighlightDialog
          highlight={openedHighlight}
          onClose={() => setOpened(null)}
          returnFocus={focusBack}
          onRemove={(highlight) => {
            setOpened(null);
            if (highlight.note !== null) setRemoving(highlight);
            else void remove(highlight);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        title="ハイライトを消しますか"
        onDismiss={() => setRemoving(null)}
        returnFocus={focusBack}
        actions={
          <>
            <Button
              variant="danger"
              onClick={() => {
                const highlight = removing;
                setRemoving(null);
                if (highlight) void remove(highlight);
              }}
            >
              消す
            </Button>
            <Button onClick={() => setRemoving(null)}>やめる</Button>
          </>
        }
      >
        <p>このハイライトのメモも一緒に消えます。元に戻せません。</p>
        {removing ? <Quote>{removing.quote}</Quote> : null}
      </ConfirmDialog>
    </>
  );
}

/**
 * The note on the whole article, above the body: a button that opens its field, and the note as written. Saving
 * an empty field removes the note.
 */
export function ArticleNoteSection({ article }: { article: Article }) {
  const actions = useAnnotationActions();
  const toast = useToast();
  const note = article.annotations.note;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  async function save(text: string) {
    setSaving(true);
    try {
      if (text.trim().length > 0) await actions.saveNote(article.id, text);
      else if (note !== null) await actions.deleteNote(article.id);
      setEditing(false);
      requestAnimationFrame(() => button.current?.focus());
    } catch {
      toast({ message: "メモを保存できませんでした。もう一度試してください。" });
    }
    setSaving(false);
  }
  return (
    <div className="flex flex-col gap-sm">
      {editing ? (
        <NoteForm
          label="記事へのメモ"
          initial={note?.text ?? ""}
          saving={saving}
          onSave={(text) => void save(text)}
          onCancel={() => {
            setEditing(false);
            requestAnimationFrame(() => button.current?.focus());
          }}
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-sm">
            <Button ref={button} onClick={() => setEditing(true)}>
              {note !== null ? "メモを書き直す" : "メモを書く"}
            </Button>
          </div>
          {note !== null ? (
            <section aria-label="記事へのメモ" className="article-note flex flex-col gap-xs">
              <h3 className="type-label-sm text-on-surface-muted">メモ</h3>
              <p className="break-words whitespace-pre-wrap type-body-md">{note.text}</p>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
