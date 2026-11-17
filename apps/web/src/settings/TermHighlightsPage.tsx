import { HIGHLIGHT_TERM_MAX_CHARS, TERM_COLORS, TERM_GROUP_NAME_MAX_CHARS, type TermColor, type TermGroup } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type Ref } from "react";
import { Link } from "react-router";
import { ApiError, checkText, fieldMessage, TERM_COLOR_LABEL } from "@smarternews/client";
import { useTermGroups } from "../api/queries.ts";
import { useApp } from "../app/context.ts";
import { usePending } from "../lib/pending.ts";
import { useToast } from "../shell/toast.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { Button, ErrorNotice, Field, Loading, messageFor } from "../ui/controls.tsx";
import { useInlineEditFocus } from "./inline-edit-focus.ts";
import { UnsavedGuard, useUnsaved } from "../ui/unsaved.tsx";

const SECTION = "flex flex-col gap-md border-b border-outline px-lg py-xl md:px-2xl";

/** Why the server refused a name or a term, in the app's words. */
function refusalOf(error: unknown, path: "name" | "text", label: string): string | null {
  if (error instanceof ApiError && error.kind === "conflict") return path === "name" ? "この名前のまとまりは登録済みです。" : "この語は、このまとまりに登録済みです。";
  return fieldMessage(error, path, label);
}

const GROUP_NAME = "まとまりの名前";

/** Sets the term groups the lists and articles colour by, so that they change without a reload. */
function useStore() {
  const client = useQueryClient();
  return {
    all: (groups: TermGroup[]) => client.setQueryData(["term-groups"], groups),
    one: (group: TermGroup) =>
      client.setQueryData<TermGroup[]>(["term-groups"], (groups) => {
        if (!groups) return [group];
        return groups.some((each) => each.id === group.id) ? groups.map((each) => (each.id === group.id ? group : each)) : [...groups, group];
      }),
    without: (id: number) => client.setQueryData<TermGroup[]>(["term-groups"], (groups) => groups?.filter((each) => each.id !== id)),
    /** Takes a term out of the group as it is now, so that a removal answered late does not bring back another. */
    withoutTerm: (groupId: number, termId: number) =>
      client.setQueryData<TermGroup[]>(["term-groups"], (groups) =>
        groups?.map((each) => (each.id === groupId ? { ...each, terms: each.terms.filter((term) => term.id !== termId) } : each)),
      ),
    /**
     * Puts the groups in the order of `groups`, keeping what each holds now. Groups not shown any more stay
     * away; groups the order does not know yet go last.
     */
    order: (groups: TermGroup[]) =>
      client.setQueryData<TermGroup[]>(["term-groups"], (current) => {
        if (!current) return groups;
        const known = new Set(groups.map((each) => each.id));
        const now = new Map(current.map((each) => [each.id, each]));
        return [...groups.flatMap((each) => now.get(each.id) ?? []), ...current.filter((each) => !known.has(each.id))];
      }),
    now: () => client.getQueryData<TermGroup[]>(["term-groups"]) ?? [],
    reload: () => void client.invalidateQueries({ queryKey: ["term-groups"] }),
  };
}

/** A sample of a colour as it colours a term: its fill and its line. */
function Swatch({ color }: { color: TermColor }) {
  return <span aria-hidden="true" className="term-swatch" data-term={color} />;
}

/** One colour of the four, chosen with a click or the arrow keys. Each is named as well as shown. */
function ColorChoice({ value, onChange }: { value: TermColor; onChange: (color: TermColor) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-xs">
      <span id={id} className="type-label-md">
        色
      </span>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-x-lg gap-y-xs type-body-md">
        {TERM_COLORS.map((color) => (
          <label key={color} className="tap inline-flex cursor-pointer items-center gap-xs">
            <input type="radio" name={id} className="accent-primary" checked={value === color} onChange={() => onChange(color)} />
            <Swatch color={color} />
            {TERM_COLOR_LABEL[color]}
          </label>
        ))}
      </div>
    </div>
  );
}

function AddGroup() {
  const { api } = useApp();
  const store = useStore();
  const toast = useToast();
  const [name, setName] = useState("");
  const [color, setColor] = useState<TermColor>("green");
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [adding, run] = usePending();
  useUnsaved("語のまとまりの追加", name.trim() !== "");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(add);
  };

  async function add() {
    const found = checkText(name, { label: GROUP_NAME, max: TERM_GROUP_NAME_MAX_CHARS });
    setProblem(found);
    if (found !== null) return;
    try {
      const created = await api.createTermGroup({ name, color });
      store.one(created);
      setName("");
      setError(null);
      toast({ message: `まとまり「${created.name}」を追加しました` });
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <form noValidate onSubmit={submit} className="flex max-w-measure flex-col gap-md">
      <Field
        label={GROUP_NAME}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setProblem(null);
        }}
        error={problem ?? refusalOf(error, "name", GROUP_NAME)}
      />
      <ColorChoice value={color} onChange={setColor} />
      {error && !(error instanceof ApiError && (error.kind === "invalid" || error.kind === "conflict")) ? <ErrorNotice error={error} /> : null}
      <div>
        <Button type="submit" variant="primary" disabled={adding || name.trim().length === 0}>
          まとまりを追加
        </Button>
      </div>
    </form>
  );
}

function EditGroup({ group, onDone }: { group: TermGroup; onDone: () => void }) {
  const { api } = useApp();
  const store = useStore();
  const toast = useToast();
  const [name, setName] = useState(group.name);
  const [color, setColor] = useState<TermColor>(group.color);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saving, run] = usePending();
  useUnsaved(`まとまり『${group.name}』の編集`, name !== group.name || color !== group.color);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(save);
  };

  async function save() {
    const found = checkText(name, { label: GROUP_NAME, max: TERM_GROUP_NAME_MAX_CHARS });
    setProblem(found);
    if (found !== null) return;
    try {
      store.one(await api.updateTermGroup(group.id, { name, color }));
      toast({ message: "まとまりを保存しました" });
      onDone();
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-md">
      <Field
        label={GROUP_NAME}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setProblem(null);
        }}
        error={problem ?? refusalOf(error, "name", GROUP_NAME)}
      />
      <ColorChoice value={color} onChange={setColor} />
      {error && !(error instanceof ApiError && (error.kind === "invalid" || error.kind === "conflict")) ? <ErrorNotice error={error} /> : null}
      <div className="flex flex-wrap gap-sm">
        <Button type="submit" variant="primary" disabled={saving || name.trim().length === 0}>
          保存する
        </Button>
        <Button onClick={onDone}>やめる</Button>
      </div>
    </form>
  );
}

function AddTerm({ group, inputRef }: { group: TermGroup; inputRef: Ref<HTMLInputElement & HTMLTextAreaElement> }) {
  const { api } = useApp();
  const store = useStore();
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const label = `「${group.name}」に足す語`;
  const [adding, run] = usePending();
  useUnsaved(`まとまり『${group.name}』への語の追加`, text.trim() !== "");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(add);
  };

  async function add() {
    const found = checkText(text, { label: "語", max: HIGHLIGHT_TERM_MAX_CHARS });
    setProblem(found);
    if (found !== null) return;
    try {
      store.one(await api.addHighlightTerm(group.id, { text }));
      setText("");
      setError(null);
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <form noValidate onSubmit={submit} className="flex max-w-measure flex-col gap-sm">
      <Field
        ref={inputRef}
        label={label}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setProblem(null);
        }}
        error={problem ?? refusalOf(error, "text", "語")}
      />
      {error && !(error instanceof ApiError && (error.kind === "invalid" || error.kind === "conflict")) ? <ErrorNotice error={error} /> : null}
      <div>
        <Button type="submit" disabled={adding || text.trim().length === 0}>
          語を追加
        </Button>
      </div>
    </form>
  );
}

/** The delete button of one term. It waits for its own answer only, so that the other terms can be deleted meanwhile. */
function RemoveTerm({ text, onRemove }: { text: string; onRemove: () => Promise<void> }) {
  const [removing, run] = usePending();
  return (
    <Button variant="quiet" aria-label={`「${text}」を削除`} disabled={removing} onClick={() => void run(onRemove)}>
      削除
    </Button>
  );
}

function GroupRow({
  group,
  first,
  last,
  onMove,
  focusMove,
  onFocused,
  afterRemoval,
}: {
  group: TermGroup;
  first: boolean;
  last: boolean;
  onMove: (group: TermGroup, direction: "up" | "down") => void;
  /** The move button to focus once the group has moved, so that a keyboard user stays where they were. */
  focusMove: "up" | "down" | null;
  /** Called once the focus has moved, so that a later change of the order does not move it again. */
  onFocused: () => void;
  /** Where the focus goes once the group is deleted and its row, with the button that asked, is gone. */
  afterRemoval: () => HTMLElement | null;
}) {
  const { api } = useApp();
  const store = useStore();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removing, run] = usePending();
  const focus = useInlineEditFocus(editing);
  const up = useRef<HTMLButtonElement>(null);
  const down = useRef<HTMLButtonElement>(null);
  const removed = useRef(false);
  const termInput = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusMove === null) return;
    // A button that cannot be pressed any more passes the focus to the other one.
    if (focusMove === "up") (first ? down : up).current?.focus();
    if (focusMove === "down") (last ? up : down).current?.focus();
    onFocused();
  }, [focusMove, first, last, onFocused]);

  async function removeGroup() {
    try {
      await api.deleteTermGroup(group.id);
      removed.current = true;
      store.without(group.id);
      setConfirming(false);
      toast({ message: `まとまり「${group.name}」を削除しました` });
    } catch (error) {
      toast({ message: messageFor(error) });
    }
  }

  async function removeTerm(termId: number, text: string) {
    try {
      await api.deleteHighlightTerm(group.id, termId);
      store.withoutTerm(group.id, termId);
      // The button that was pressed is gone with the term; the focus stays in the group, where terms are added.
      termInput.current?.focus();
      toast({ message: `語「${text}」を削除しました` });
    } catch (error) {
      toast({ message: messageFor(error) });
    }
  }

  const summary = [group.name, TERM_COLOR_LABEL[group.color], ...group.terms.map((term) => term.text)].join(" ");
  return (
    <li data-group={group.name} data-group-summary={summary} className="flex flex-col gap-sm border-b border-outline py-md type-body-md">
      <div className="flex flex-wrap items-center gap-x-lg gap-y-xs">
        <h3 className="min-w-0 break-words type-label-md">{group.name}</h3>
        <span className="inline-flex items-center gap-xs text-on-surface-muted">
          <Swatch color={group.color} />
          {TERM_COLOR_LABEL[group.color]}
        </span>
      </div>
      {group.terms.length === 0 ? (
        <p className="text-on-surface-muted">語はまだありません。</p>
      ) : (
        <ul aria-label={`「${group.name}」の語`} className="flex flex-wrap gap-sm">
          {group.terms.map((term) => (
            <li key={term.id} className="inline-flex min-w-0 items-center gap-xs rounded-sm border border-outline pl-sm">
              <span className="min-w-0 break-words">{term.text}</span>
              <RemoveTerm text={term.text} onRemove={() => removeTerm(term.id, term.text)} />
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <div ref={focus.region}>
          <EditGroup group={group} onDone={() => setEditing(false)} />
        </div>
      ) : (
        <>
          <AddTerm group={group} inputRef={termInput} />
          <div className="flex flex-wrap gap-sm pt-xs">
            <Button ref={up} aria-label={`${group.name}を上へ`} disabled={first} onClick={() => onMove(group, "up")}>
              上へ
            </Button>
            <Button ref={down} aria-label={`${group.name}を下へ`} disabled={last} onClick={() => onMove(group, "down")}>
              下へ
            </Button>
            <Button ref={focus.opener} aria-label={`${group.name}を編集`} onClick={() => setEditing(true)}>
              編集
            </Button>
            <Button aria-label={`${group.name}を削除`} onClick={() => setConfirming(true)}>
              削除
            </Button>
          </div>
        </>
      )}
      <ConfirmDialog
        open={confirming}
        title="語のまとまりを削除しますか"
        onDismiss={() => setConfirming(false)}
        returnFocus={() => (removed.current ? afterRemoval() : null)}
        actions={
          <>
            <Button variant="danger" disabled={removing} onClick={() => void run(removeGroup)}>
              削除する
            </Button>
            <Button onClick={() => setConfirming(false)}>やめる</Button>
          </>
        }
      >
        <p>
          まとまり「{group.name}」が消えます。{group.terms.length > 0 ? `このまとまりの語${group.terms.length}つも消えます。` : ""}
          記事は消えません。
        </p>
      </ConfirmDialog>
    </li>
  );
}

/** Term groups and their terms, coloured in the lists and the texts of articles. */
export function TermHighlightsPage() {
  return (
    <UnsavedGuard>
      <TermHighlights />
    </UnsavedGuard>
  );
}

function TermHighlights() {
  const { api } = useApp();
  const store = useStore();
  const toast = useToast();
  const groups = useTermGroups();
  // Cleared once the moved group has taken the focus, so that adding or deleting a group later leaves the focus alone.
  const [moved, setMoved] = useState<{ id: number; direction: "up" | "down" } | null>(null);
  const focused = useCallback(() => setMoved(null), []);
  const listHeading = useRef<HTMLHeadingElement>(null);

  // Moves go to the server one by one: each names the group to go before, which means what the screen shows
  // only once the server has the moves before it.
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** Moves sent or waiting to be sent. The order an answer brings is shown only when none is left. */
  const pending = useRef(0);
  /** Goes up when a move fails, so that the moves pressed before it are dropped. */
  const round = useRef(0);

  function move(group: TermGroup, direction: "up" | "down") {
    const list = store.now();
    const at = list.findIndex((each) => each.id === group.id);
    const to = direction === "up" ? at - 1 : at + 1;
    if (at < 0 || to < 0 || to >= list.length) return;
    // Up: before the one above. Down: before the one two below, or last.
    const before = direction === "up" ? list[at - 1]!.id : (list[at + 2]?.id ?? null);
    const next = list.filter((each) => each.id !== group.id);
    next.splice(to, 0, list[at]!);
    store.all(next);
    setMoved({ id: group.id, direction });

    pending.current += 1;
    const sent = round.current;
    queue.current = queue.current.then(async () => {
      if (sent !== round.current) return;
      try {
        const answer = await api.moveTermGroup(group.id, before);
        pending.current -= 1;
        if (pending.current === 0) store.order(answer);
      } catch {
        round.current += 1;
        pending.current = 0;
        store.reload();
        toast({ message: "並べ替えられませんでした。もう一度試してください。" });
      }
    });
  }

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <header className="flex flex-col gap-xs border-b border-outline px-lg py-md md:px-2xl">
        <Link to="/settings" className="tap type-body-md text-primary underline underline-offset-4">
          設定へ戻る
        </Link>
        <h1 className="type-headline-md">語の色付け</h1>
      </header>
      <section aria-label="語のまとまりの追加" className={SECTION}>
        <h2 className="type-headline-md">追加</h2>
        <p className="max-w-measure type-label-sm text-on-surface-muted">
          まとまりに登録した語を、生成記事と配信記事の一覧と本文で、まとまりの色で色付けします。大文字と小文字、全角と半角は区別しません。記事は隠しません。
        </p>
        <AddGroup />
      </section>
      <section aria-label="語のまとまりの一覧" className={SECTION}>
        <h2 ref={listHeading} tabIndex={-1} className="type-headline-md">
          一覧
        </h2>
        <p className="max-w-measure type-label-sm text-on-surface-muted">
          1つの箇所が複数のまとまりの語に一致したときは、上にあるまとまりの色で色付けします。「上へ」と「下へ」で順を変えられます。
        </p>
        {groups.isError ? <ErrorNotice error={groups.error} onRetry={() => void groups.refetch()} /> : null}
        {groups.isPending && !groups.isError ? <Loading /> : null}
        {groups.data?.length === 0 ? <p className="type-body-md text-on-surface-muted">語のまとまりはまだありません。</p> : null}
        <ul aria-label="語のまとまり" className="max-w-measure-article">
          {groups.data?.map((group, index) => (
            <GroupRow
              key={group.id}
              group={group}
              first={index === 0}
              last={index === groups.data.length - 1}
              onMove={move}
              focusMove={moved?.id === group.id ? moved.direction : null}
              onFocused={focused}
              afterRemoval={() => listHeading.current}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
