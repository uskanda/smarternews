import type { HighlightTermCreate, TermColor, TermGroup, TermGroupCreate, TermGroupUpdate } from "../api.ts";
import type { Clock } from "../clock.ts";
import { DomainError, notFound } from "../errors.ts";
import { normalizeForMatch } from "../search/text.ts";
import { transaction, type Database } from "./database.ts";
import { num, str } from "./rows.ts";

// Term groups and their terms. Only the terms are stored: the apps match them against what they show, so
// nothing here touches an article, and no model is involved.

/** Every term group in its order, each with its terms in the order they were added. */
export function listTermGroups(db: Database): TermGroup[] {
  const terms = new Map<number, TermGroup["terms"]>();
  for (const row of db.prepare("SELECT id, group_id, text FROM highlight_terms ORDER BY id").all()) {
    const list = terms.get(num(row.group_id)) ?? [];
    list.push({ id: num(row.id), text: str(row.text) });
    terms.set(num(row.group_id), list);
  }
  return db
    .prepare("SELECT id, name, color FROM term_groups ORDER BY position, id")
    .all()
    .map((row) => ({ id: num(row.id), name: str(row.name), color: str(row.color) as TermColor, terms: terms.get(num(row.id)) ?? [] }));
}

export function getTermGroup(db: Database, id: number): TermGroup {
  const group = listTermGroups(db).find((candidate) => candidate.id === id);
  if (!group) throw notFound("term group", id);
  return group;
}

export function findTermGroupByName(db: Database, name: string): TermGroup | null {
  const row = db.prepare("SELECT id FROM term_groups WHERE name = ?").get(name);
  return row ? getTermGroup(db, num(row.id)) : null;
}

function refuseTakenName(db: Database, name: string, except?: number): void {
  const row = db.prepare("SELECT id FROM term_groups WHERE name = ?").get(name);
  if (row && num(row.id) !== except) {
    throw new DomainError("conflict", `the term group "${name}" is already registered`, [{ path: "name", message: "already registered" }]);
  }
}

/** Registers a term group at the end of the order. Green unless a colour is given. */
export function createTermGroup(db: Database, input: TermGroupCreate, clock: Clock): TermGroup {
  refuseTakenName(db, input.name);
  const id = num(
    db
      .prepare(
        `INSERT INTO term_groups (name, color, position, created_at)
         VALUES (?, ?, (SELECT coalesce(max(position), 0) + 1 FROM term_groups), ?)`,
      )
      .run(input.name, input.color ?? "green", clock().toISOString()).lastInsertRowid,
  );
  return getTermGroup(db, id);
}

/** Changes the name or colour of a term group. Its terms and place stay. */
export function updateTermGroup(db: Database, id: number, patch: TermGroupUpdate): TermGroup {
  const current = getTermGroup(db, id);
  const name = patch.name ?? current.name;
  refuseTakenName(db, name, id);
  db.prepare("UPDATE term_groups SET name = ?, color = ? WHERE id = ?").run(name, patch.color ?? current.color, id);
  return getTermGroup(db, id);
}

/** Removes a term group with its terms (ON DELETE CASCADE). */
export function deleteTermGroup(db: Database, id: number): void {
  getTermGroup(db, id);
  db.prepare("DELETE FROM term_groups WHERE id = ?").run(id);
}

/** Stores the order of all term groups: the given ones first, in that order, then the rest as they were. */
export function orderTermGroups(db: Database, ids: number[]): void {
  const first = new Set(ids);
  const all = [...ids, ...listTermGroups(db).map((group) => group.id).filter((id) => !first.has(id))];
  const set = db.prepare("UPDATE term_groups SET position = ? WHERE id = ?");
  transaction(db, () => all.forEach((id, index) => set.run(index + 1, id)));
}

/** Puts one term group before another, or last when `before` is null. The others keep their order. */
export function moveTermGroup(db: Database, id: number, before: number | null): TermGroup[] {
  getTermGroup(db, id);
  if (before !== null && !db.prepare("SELECT 1 FROM term_groups WHERE id = ?").get(before)) {
    throw new DomainError("invalid", `term group ${before} does not exist`, [{ path: "before", message: "no such term group" }]);
  }
  if (before !== id) {
    const others = listTermGroups(db)
      .map((group) => group.id)
      .filter((other) => other !== id);
    const at = before === null ? others.length : others.indexOf(before);
    orderTermGroups(db, [...others.slice(0, at), id, ...others.slice(at)]);
  }
  return listTermGroups(db);
}

/**
 * Adds a term to a group and answers with the group. The same term, whatever its case and width, is refused
 * in the same group; another group may have it too.
 */
export function addHighlightTerm(db: Database, groupId: number, input: HighlightTermCreate, clock: Clock): TermGroup {
  getTermGroup(db, groupId);
  const normalized = normalizeForMatch(input.text);
  if (db.prepare("SELECT 1 FROM highlight_terms WHERE group_id = ? AND normalized = ?").get(groupId, normalized)) {
    throw new DomainError("conflict", `the term "${input.text}" is already in this group`, [{ path: "text", message: "already registered" }]);
  }
  db.prepare("INSERT INTO highlight_terms (group_id, text, normalized, created_at) VALUES (?, ?, ?, ?)").run(
    groupId,
    input.text,
    normalized,
    clock().toISOString(),
  );
  return getTermGroup(db, groupId);
}

/** Removes one term of a group. A term of another group is not found. */
export function deleteHighlightTerm(db: Database, groupId: number, termId: number): void {
  getTermGroup(db, groupId);
  const result = db.prepare("DELETE FROM highlight_terms WHERE id = ? AND group_id = ?").run(termId, groupId);
  if (num(result.changes) === 0) throw notFound("term", termId);
}
