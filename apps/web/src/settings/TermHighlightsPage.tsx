import { TERM_COLORS, type TermColor, type TermGroup } from "@smarternews/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ApiError, TERM_COLOR_LABEL } from "@smarternews/client";
import { useTermGroups } from "../api/queries.ts";
import { useApp } from "../app/context.ts";
import { useToast } from "../shell/toast.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { Button, ErrorNotice, Field, fieldError, Loading, messageFor } from "../ui/controls.tsx";

const SECTION = "flex flex-col gap-md border-b border-outline px-lg py-xl md:px-2xl";

/** Why the server refused a name or a term, in the app's words. */
function refusalOf(error: unknown, path: string): string | null {
  if (error instanceof ApiError && error.kind === "conflict") return path === "name" ? "この名前のまとまりは登録済みです。" : "この語は、このまとまりに登録済みです。";
  const reason = fieldError(error, path);
  return reason ? `この値は保存できません（${reason}）` : null;
}

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
  const [error, setError] = useState<unknown>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
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
    <form onSubmit={add} className="flex max-w-measure flex-col gap-md">
      <Field label="まとまりの名前" value={name} onChange={(event) => setName(event.target.value)} error={refusalOf(error, "name")} />
      <ColorChoice value={color} onChange={setColor} />
      {error && !(error instanceof ApiError && (error.kind === "invalid" || error.kind === "conflict")) ? <ErrorNotice error={error} /> : null}
      <div>
        <Button type="submit" variant="primary" disabled={name.trim().length === 0}>
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
  const [error, setError] = useState<unknown>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      store.one(await api.updateTermGroup(group.id, { name, color }));
      toast({ message: "まとまりを保存しました" });
      onDone();
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-md">
      <Field label="まとまりの名前" value={name} onChange={(event) => setName(event.target.value)} error={refusalOf(error, "name")} />
      <ColorChoice value={color} onChange={setColor} />
      {error && !(error instanceof ApiError && (error.kind === "invalid" || error.kind === "conflict")) ? <ErrorNotice error={error} /> : null}
      <div className="flex flex-wrap gap-sm">
        <Button type="submit" variant="primary" disabled={name.trim().length === 0}>
          保存
        </Button>
        <Button onClick={onDone}>やめる</Button>
      </div>
    </form>
  );
}

function AddTerm({ group }: { group: TermGroup }) {
  const { api } = useApp();
  const store = useStore();
  const [text, setText] = useState("");
  const [error, setError] = useState<unknown>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
    try {
      store.one(await api.addHighlightTerm(group.id, { text }));
      setText("");
      setError(null);
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <form onSubmit={add} className="flex max-w-measure flex-col gap-sm">
      <Field label={`「${group.name}」に足す語`} value={text} onChange={(event) => setText(event.target.value)} error={refusalOf(error, "text")} />
      {error && !(error instanceof ApiError && (error.kind === "invalid" || error.kind === "conflict")) ? <ErrorNotice error={error} /> : null}
      <div>
        <Button type="submit" disabled={text.trim().length === 0}>
          語を追加
        </Button>
      </div>
    </form>
  );
}

function GroupRow({
  group,
  first,
  last,
  onMove,
  focusMove,
}: {
  group: TermGroup;
  first: boolean;
  last: boolean;
  onMove: (group: TermGroup, direction: "up" | "down") => void;
  /** The move button to focus once the group has moved, so that a keyboard user stays where they were. */
  focusMove: { direction: "up" | "down"; serial: number } | null;
}) {
  const { api } = useApp();
  const store = useStore();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const up = useRef<HTMLButtonElement>(null);
  const down = useRef<HTMLButtonElement>(null);

  const direction = focusMove?.direction;
  const serial = focusMove?.serial;
  useEffect(() => {
    // A button that cannot be pressed any more passes the focus to the other one.
    if (direction === "up") (first ? down : up).current?.focus();
    if (direction === "down") (last ? up : down).current?.focus();
    // Run again for every move, also one in the same direction as the last.
  }, [direction, serial, first, last]);

  async function removeGroup() {
    try {
      await api.deleteTermGroup(group.id);
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
      store.one({ ...group, terms: group.terms.filter((term) => term.id !== termId) });
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
              <Button variant="quiet" aria-label={`「${term.text}」を削除`} onClick={() => void removeTerm(term.id, term.text)}>
                削除
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <EditGroup
          group={group}
          onDone={() => {
            setEditing(false);
            editButton.current?.focus();
          }}
        />
      ) : (
        <>
          <AddTerm group={group} />
          <div className="flex flex-wrap gap-sm pt-xs">
            <Button ref={up} aria-label={`${group.name}を上へ`} disabled={first} onClick={() => onMove(group, "up")}>
              上へ
            </Button>
            <Button ref={down} aria-label={`${group.name}を下へ`} disabled={last} onClick={() => onMove(group, "down")}>
              下へ
            </Button>
            <Button ref={editButton} aria-label={`${group.name}を編集`} onClick={() => setEditing(true)}>
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
        actions={
          <>
            <Button variant="danger" onClick={() => void removeGroup()}>
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
  const { api } = useApp();
  const store = useStore();
  const toast = useToast();
  const groups = useTermGroups();
  const [moved, setMoved] = useState<{ id: number; direction: "up" | "down"; serial: number } | null>(null);

  async function move(group: TermGroup, direction: "up" | "down") {
    const list = groups.data ?? [];
    const at = list.findIndex((each) => each.id === group.id);
    // Up: before the one above. Down: before the one two below, or last.
    const before = direction === "up" ? list[at - 1]!.id : (list[at + 2]?.id ?? null);
    try {
      store.all(await api.moveTermGroup(group.id, before));
      setMoved((last) => ({ id: group.id, direction, serial: (last?.serial ?? 0) + 1 }));
    } catch (error) {
      toast({ message: messageFor(error) });
    }
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
        <h2 className="type-headline-md">一覧</h2>
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
              onMove={(target, direction) => void move(target, direction)}
              focusMove={moved?.id === group.id ? moved : null}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
