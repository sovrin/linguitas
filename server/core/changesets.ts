// Changesets: the key changes a feature needs, kept apart from the draft as a work order (add a key,
// update its texts, remove it) until the owner applies them all at once, just before the feature
// goes live. Until then sites and the draft see nothing of them; a developer's build reads the
// draft with one laid over it.
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from '#nexitas/server/core/database'
import type {
  Change,
  ChangeInput,
  Changeset,
  ChangesetSummary,
  Conflict,
  Op,
  TextKey,
} from '#self/shared/contracts'
import { deleteKey, getKey, insertKey, type Space, writeKey } from './translations'
import { listUsage } from './usage'

/** A change the changeset cannot take, said for the owner or the assistant that asked. */
export class ChangeRefused extends Error {}

interface ChangeRow {
  key: string
  op: Op
  note: string | null
  texts: string
  confirmed: string
  base: string | null
  applied_at: number | null
  updated_at: number
}

const toChange = (row: ChangeRow): Change => ({
  key: row.key,
  op: row.op,
  note: row.note,
  texts: JSON.parse(row.texts),
  confirmed: JSON.parse(row.confirmed),
  base: row.base ? JSON.parse(row.base) : null,
  appliedAt: row.applied_at,
  updatedAt: row.updated_at,
})

/** Starts a changeset. False when the project has one by that name already. */
export function createChangeset(
  db: DatabaseSync,
  projectId: string,
  name: string,
  note = '',
  now = Date.now(),
) {
  return (
    db
      .prepare(
        `INSERT OR IGNORE INTO translation_changesets (project_id, name, note, created_at)
        VALUES (?, ?, ?, ?)`,
      )
      .run(projectId, name, note, now).changes === 1
  )
}

/** The project's changesets, open ones first, the newest first within each. */
export function listChangesets(db: DatabaseSync, projectId: string): ChangesetSummary[] {
  return db
    .prepare(
      `SELECT c.name, c.note, c.created_at AS createdAt, c.applied_at AS appliedAt,
        (SELECT count(*) FROM translation_changeset_ops o
          WHERE o.project_id = c.project_id AND o.changeset = c.name) AS changes,
        (SELECT count(*) FROM translation_changeset_ops o
          WHERE o.project_id = c.project_id AND o.changeset = c.name AND o.applied_at IS NULL)
          AS pending
      FROM translation_changesets c WHERE c.project_id = ?
      ORDER BY c.applied_at IS NOT NULL, c.created_at DESC, c.name`,
    )
    .all(projectId) as unknown as ChangesetSummary[]
}

export function getChangeset(db: DatabaseSync, projectId: string, name: string): Changeset | null {
  const row = db
    .prepare(
      `SELECT name, note, created_at, applied_at FROM translation_changesets
      WHERE project_id = ? AND name = ?`,
    )
    .get(projectId, name) as
    | { name: string; note: string; created_at: number; applied_at: number | null }
    | undefined
  if (!row) return null
  const changes = db
    .prepare(
      `SELECT key, op, note, texts, confirmed, base, applied_at, updated_at
      FROM translation_changeset_ops WHERE project_id = ? AND changeset = ? ORDER BY key`,
    )
    .all(projectId, name) as unknown as ChangeRow[]
  return {
    name: row.name,
    note: row.note,
    createdAt: row.created_at,
    appliedAt: row.applied_at,
    changes: changes.map(toChange),
  }
}

/** Deletes a changeset with its changes; what it applied stays applied. */
export function deleteChangeset(db: DatabaseSync, projectId: string, name: string) {
  return (
    db
      .prepare('DELETE FROM translation_changesets WHERE project_id = ? AND name = ?')
      .run(projectId, name).changes === 1
  )
}

/** Drops a change that waits to be applied. False when there is none for the key. */
export function dropChange(db: DatabaseSync, projectId: string, name: string, key: string) {
  return (
    db
      .prepare(
        `DELETE FROM translation_changeset_ops
        WHERE project_id = ? AND changeset = ? AND key = ? AND applied_at IS NULL`,
      )
      .run(projectId, name, key).changes === 1
  )
}

/** The open changesets that add each key: what sync names when code asks for a key that is not
 *  in the draft yet. */
export function pendingAdds(db: DatabaseSync, projectId: string) {
  const rows = db
    .prepare(
      `SELECT key, changeset FROM translation_changeset_ops
      WHERE project_id = ? AND op = 'add' AND applied_at IS NULL ORDER BY key, changeset`,
    )
    .all(projectId) as unknown as { key: string; changeset: string }[]
  const out: Record<string, string[]> = {}
  for (const row of rows) (out[row.key] ??= []).push(row.changeset)
  return out
}

const textsOf = (key: TextKey) =>
  Object.fromEntries(Object.entries(key.texts).map(([at, text]) => [at, text.text]))

/** Writes changes into an open changeset, all or none. A key holds one change: a later one for it
 *  is merged in, so texts can come a language at a time. An update keeps only what differs from
 *  the draft, so a form that sends every language changes only what was edited. */
export function saveChanges(
  db: DatabaseSync,
  projectId: string,
  space: Space,
  name: string,
  inputs: ChangeInput[],
  now = Date.now(),
) {
  return transaction(db, () => {
    const changeset = getChangeset(db, projectId, name)
    if (!changeset) throw new ChangeRefused(`There is no changeset ${name}.`)
    if (changeset.appliedAt)
      throw new ChangeRefused(`${name} is applied already: start a new changeset.`)
    const held = new Map(changeset.changes.map((change) => [change.key, change]))
    const save = db.prepare(
      `INSERT INTO translation_changeset_ops
        (project_id, changeset, key, op, note, texts, confirmed, base, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (project_id, changeset, key) DO UPDATE
      SET op = excluded.op, note = excluded.note, texts = excluded.texts,
        confirmed = excluded.confirmed, base = excluded.base, updated_at = excluded.updated_at`,
    )
    const drop = db.prepare(
      'DELETE FROM translation_changeset_ops WHERE project_id = ? AND changeset = ? AND key = ?',
    )
    for (const input of inputs) {
      const before = held.get(input.key)
      if (before?.appliedAt) throw new ChangeRefused(`${input.key} is applied already in ${name}.`)
      if (input.op !== 'remove')
        for (const locale of Object.keys(input.texts))
          if (!space.locales.includes(locale))
            throw new ChangeRefused(`The project has no language ${locale}.`)
      const next = merge(getKey(db, projectId, input.key), before, input)
      if (next) {
        save.run(
          projectId,
          name,
          input.key,
          next.op,
          next.note,
          JSON.stringify(next.texts),
          JSON.stringify(next.confirmed),
          next.base ? JSON.stringify(next.base) : null,
          now,
        )
        held.set(input.key, { ...next, key: input.key, appliedAt: null, updatedAt: now })
      } else {
        drop.run(projectId, name, input.key)
        held.delete(input.key)
      }
    }
  })
}

type Pending = Pick<Change, 'op' | 'note' | 'texts' | 'confirmed' | 'base'>

/** A key's change once `input` is merged into the one it holds (`before`), against the draft's
 *  key (`current`); null when nothing is left to change. */
function merge(
  current: TextKey | null,
  before: Change | undefined,
  input: ChangeInput,
): Pending | null {
  const { key } = input
  if (input.op === 'remove') {
    // Removing a key the changeset adds takes the add back.
    if (before?.op === 'add') return null
    if (!current) throw new ChangeRefused(`There is no key ${key} to remove.`)
    return { op: 'remove', note: null, texts: {}, confirmed: [], base: null }
  }
  const note = input.note ?? null
  // Writing a key the changeset adds, by either op, adds to it.
  if (before?.op === 'add' || (input.op === 'add' && !current)) {
    if (current) throw new ChangeRefused(`${key} exists in the draft already: update it.`)
    const texts = Object.fromEntries(
      Object.entries({ ...before?.texts, ...input.texts }).filter(([, text]) => text),
    )
    return { op: 'add', note: note ?? before?.note ?? null, texts, confirmed: [], base: null }
  }
  if (input.op === 'add') throw new ChangeRefused(`${key} exists already: update it.`)
  if (!current) throw new ChangeRefused(`There is no key ${key}. Add it.`)
  const confirmed = 'confirmed' in input ? input.confirmed : []
  const own = before?.op === 'update' ? before : undefined
  const texts = { ...own?.texts }
  for (const [locale, text] of Object.entries(input.texts)) {
    // What the draft says already, unless confirmed, is no change: it leaves the change.
    if (text === (current.texts[locale]?.text ?? '') && !confirmed.includes(locale))
      delete texts[locale]
    else texts[locale] = text
  }
  const mergedNote = note === null ? (own?.note ?? null) : note === current.note ? null : note
  const allConfirmed = [...new Set([...(own?.confirmed ?? []), ...confirmed])]
  if (!Object.keys(texts).length && mergedNote === null && !allConfirmed.length) return null
  return {
    op: 'update',
    note: mergedNote,
    texts,
    confirmed: allConfirmed,
    base: { note: current.note, texts: textsOf(current) },
  }
}

/** What stops the changeset's pending changes from applying: a key added in the draft meanwhile,
 *  a key updated that is gone, or a text it changes that changed in the draft since. And the
 *  removals of keys sites' code still uses, held back unless `removeUsed`. */
export function checkChangeset(
  db: DatabaseSync,
  projectId: string,
  changeset: Changeset,
  removeUsed = false,
) {
  const usage = listUsage(db, projectId)
  const conflicts: Conflict[] = []
  const held: { key: string; consumers: string[] }[] = []
  for (const change of changeset.changes) {
    if (change.appliedAt) continue
    const current = getKey(db, projectId, change.key)
    if (change.op === 'add' && current)
      conflicts.push({ key: change.key, why: 'It was added to the draft meanwhile.' })
    if (change.op === 'update') {
      if (!current) {
        conflicts.push({ key: change.key, why: 'It was removed from the draft meanwhile.' })
        continue
      }
      for (const locale of Object.keys(change.texts))
        if ((current.texts[locale]?.text ?? '') !== (change.base?.texts[locale] ?? ''))
          conflicts.push({ key: change.key, why: `Its ${locale} text changed in the draft since.` })
      if (change.note !== null && current.note !== change.base?.note)
        conflicts.push({ key: change.key, why: 'Its note changed in the draft since.' })
    }
    if (change.op === 'remove' && current && usage[change.key] && !removeUsed)
      held.push({ key: change.key, consumers: usage[change.key]! })
  }
  return { conflicts, held }
}

/** Writes one change into the draft, over whatever the draft has: an add on a key that exists
 *  updates it, an update on one that is gone adds it. Apply checks for those first; a preview
 *  lets the changeset win. */
function write(
  db: DatabaseSync,
  projectId: string,
  locales: string[],
  change: Change,
  now: number,
) {
  const current = getKey(db, projectId, change.key)
  if (change.op === 'remove') {
    deleteKey(db, projectId, change.key)
    return
  }
  const input = {
    note: change.note ?? current?.note ?? '',
    texts: change.texts,
    confirmed: change.confirmed,
  }
  if (current) writeKey(db, projectId, locales, change.key, input, now)
  else insertKey(db, projectId, locales, change.key, input, now)
}

/** Applies the changeset's pending changes to the draft, all at once: nothing when anything
 *  conflicts. Removals of keys still in use wait (`held`) unless `removeUsed`; the changeset stays
 *  open until they are applied too. Publishing stays a step of its own. */
export function applyChangeset(
  db: DatabaseSync,
  projectId: string,
  space: Space,
  name: string,
  { removeUsed = false } = {},
  now = Date.now(),
) {
  return transaction(db, () => {
    const changeset = getChangeset(db, projectId, name)
    if (!changeset) throw new ChangeRefused(`There is no changeset ${name}.`)
    const { conflicts, held } = checkChangeset(db, projectId, changeset, removeUsed)
    if (conflicts.length) return { applied: [] as string[], conflicts, held }
    const waiting = new Set(held.map((item) => item.key))
    const mark = db.prepare(
      `UPDATE translation_changeset_ops SET applied_at = ?
      WHERE project_id = ? AND changeset = ? AND key = ?`,
    )
    const applied: string[] = []
    for (const change of changeset.changes) {
      if (change.appliedAt || waiting.has(change.key)) continue
      write(db, projectId, space.locales, change, now)
      mark.run(now, projectId, name, change.key)
      applied.push(change.key)
    }
    if (!waiting.size)
      db.prepare(
        'UPDATE translation_changesets SET applied_at = ? WHERE project_id = ? AND name = ?',
      ).run(now, projectId, name)
    return { applied, conflicts, held }
  })
}

/** What `read` finds with the changeset's pending changes laid over the draft, as applying would
 *  write them. They are written in a savepoint and rolled back, so the preview is exactly what
 *  apply does, with nothing kept. */
export function withChangeset<T>(
  db: DatabaseSync,
  projectId: string,
  space: Space,
  changeset: Changeset,
  read: () => T,
): T {
  db.exec('SAVEPOINT changeset_preview')
  try {
    for (const change of changeset.changes)
      if (!change.appliedAt) write(db, projectId, space.locales, change, Date.now())
    return read()
  } finally {
    db.exec('ROLLBACK TO changeset_preview')
    db.exec('RELEASE changeset_preview')
  }
}
