// A project's translations: its delivery token, its languages, its keys with their texts, and what
// was last published. A project's translations own its keys, a key its texts; deleting one deletes
// what it owns (foreign keys cascade, see module.ts).
import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from '#nexitas/server/core/database'
import type { KeyInput, Snapshot, Text, TextKey } from '../../shared/contracts'

/** A read token for the delivery API. Shown to the owner, so it is kept as it is. */
export const newToken = () => `lt_${randomBytes(24).toString('base64url')}`

// ── A project's translations

interface SpaceRow {
  token: string
  source: string
  published: string | null
  version: number
  published_at: number | null
}

export interface Space {
  token: string
  source: string
  /** Every language the owner works in, the source first, then in the order they were added. */
  locales: string[]
  /** The ones the next publish delivers, in the same order. The source is always one. */
  live: string[]
  published: Snapshot | null
  version: number
  publishedAt: number | null
}

export function getSpace(db: DatabaseSync, projectId: string): Space | null {
  const row = db
    .prepare(
      `SELECT token, source, published, version, published_at FROM translation_projects
      WHERE project_id = ?`,
    )
    .get(projectId) as SpaceRow | undefined
  if (!row) return null
  const locales = db
    .prepare(
      `SELECT locale, live FROM translation_locales WHERE project_id = ?
      ORDER BY locale = ? DESC, created_at, locale`,
    )
    .all(projectId, row.source) as unknown as { locale: string; live: number }[]
  return {
    token: row.token,
    source: row.source,
    locales: locales.map((locale) => locale.locale),
    live: locales.filter((locale) => locale.live).map((locale) => locale.locale),
    published: row.published ? JSON.parse(row.published) : null,
    version: row.version,
    publishedAt: row.published_at,
  }
}

/** Starts translations for a project, with English as its source. False when it has them
 *  already. */
export function createSpace(db: DatabaseSync, projectId: string, now = Date.now()) {
  return transaction(db, () => {
    const created =
      db
        .prepare(
          `INSERT OR IGNORE INTO translation_projects (project_id, token, source, created_at)
          VALUES (?, ?, 'en', ?)`,
        )
        .run(projectId, newToken(), now).changes === 1
    if (created)
      db.prepare(
        `INSERT INTO translation_locales (project_id, locale, live, created_at)
        VALUES (?, 'en', 1, ?)`,
      ).run(projectId, now)
    return created
  })
}

/** A new token; the old one stops working at once. */
export function rotateToken(db: DatabaseSync, projectId: string) {
  db.prepare('UPDATE translation_projects SET token = ? WHERE project_id = ?').run(
    newToken(),
    projectId,
  )
}

// ── Languages

/** Adds a language as a draft: written and checked here, delivered only once it is live. Texts it
 *  had before it was removed come back with it. False when the project has it already. */
export function addLocale(db: DatabaseSync, projectId: string, locale: string, now = Date.now()) {
  return (
    db
      .prepare(
        `INSERT OR IGNORE INTO translation_locales (project_id, locale, live, created_at)
        VALUES (?, ?, 0, ?)`,
      )
      .run(projectId, locale, now).changes === 1
  )
}

/** Whether the next publish delivers the language. Sites see the change only then. */
export function setLive(db: DatabaseSync, projectId: string, locale: string, live: boolean) {
  db.prepare('UPDATE translation_locales SET live = ? WHERE project_id = ? AND locale = ?').run(
    live ? 1 : 0,
    projectId,
    locale,
  )
}

/** Takes a language out of the admin. Its texts stay, unseen, until it is added again. */
export function removeLocale(db: DatabaseSync, projectId: string, locale: string) {
  db.prepare('DELETE FROM translation_locales WHERE project_id = ? AND locale = ?').run(
    projectId,
    locale,
  )
}

/** Makes another live language the source. Translations that were up to date with the old source
 *  stay up to date, as long as the new source was too: they all said the same thing. Any other
 *  translation, the old source's own text included, is stale against the new source. */
export function setSource(db: DatabaseSync, projectId: string, space: Space, locale: string) {
  transaction(db, () => {
    const save = db.prepare(
      'UPDATE translation_texts SET based_on = ? WHERE project_id = ? AND key = ? AND locale = ?',
    )
    for (const key of listKeys(db, projectId)) {
      const before = key.texts[space.source]?.text ?? ''
      const next = key.texts[locale]
      const fresh = !!next && next.basedOn === before
      for (const [other, text] of Object.entries(key.texts)) {
        if (other === locale) save.run(null, projectId, key.key, other)
        else if (other === space.source)
          save.run(fresh ? next.text : before, projectId, key.key, other)
        else if (fresh && text.basedOn === before) save.run(next.text, projectId, key.key, other)
      }
    }
    db.prepare('UPDATE translation_projects SET source = ? WHERE project_id = ?').run(
      locale,
      projectId,
    )
  })
}

/** Deletes a project's translations: every key and text. */
export function deleteSpace(db: DatabaseSync, projectId: string) {
  db.prepare('DELETE FROM translation_projects WHERE project_id = ?').run(projectId)
}

// ── Keys and their texts

interface KeyRow {
  key: string
  note: string
  updated_at: number
}

interface TextRow {
  key: string
  locale: string
  text: string
  based_on: string | null
  updated_at: number
}

const toText = (row: TextRow): Text => ({
  text: row.text,
  basedOn: row.based_on,
  updatedAt: row.updated_at,
})

/** A project's keys in key order, each with its texts in every language it has one in. */
export function listKeys(db: DatabaseSync, projectId: string): TextKey[] {
  const keys = new Map<string, TextKey>()
  const keyRows = db
    .prepare('SELECT key, note, updated_at FROM translation_keys WHERE project_id = ? ORDER BY key')
    .all(projectId) as unknown as KeyRow[]
  for (const row of keyRows)
    keys.set(row.key, { key: row.key, note: row.note, texts: {}, updatedAt: row.updated_at })
  const textRows = db
    .prepare(
      `SELECT key, locale, text, based_on, updated_at FROM translation_texts WHERE project_id = ?`,
    )
    .all(projectId) as unknown as TextRow[]
  for (const row of textRows) keys.get(row.key)!.texts[row.locale] = toText(row)
  return [...keys.values()]
}

export function getKey(db: DatabaseSync, projectId: string, key: string): TextKey | null {
  const row = db
    .prepare('SELECT key, note, updated_at FROM translation_keys WHERE project_id = ? AND key = ?')
    .get(projectId, key) as KeyRow | undefined
  if (!row) return null
  const texts = db
    .prepare(
      `SELECT key, locale, text, based_on, updated_at FROM translation_texts
      WHERE project_id = ? AND key = ?`,
    )
    .all(projectId, key) as unknown as TextRow[]
  return {
    key: row.key,
    note: row.note,
    texts: Object.fromEntries(texts.map((text) => [text.locale, toText(text)])),
    updatedAt: row.updated_at,
  }
}

/** Adds a key with its note and texts. False when the project has it already. */
export function createKey(
  db: DatabaseSync,
  projectId: string,
  locales: string[],
  key: string,
  input: KeyInput,
  now = Date.now(),
) {
  return transaction(db, () => {
    const created =
      db
        .prepare(
          `INSERT OR IGNORE INTO translation_keys (project_id, key, note, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)`,
        )
        .run(projectId, key, input.note, now, now).changes === 1
    if (created) writeTexts(db, projectId, locales, key, input.texts, input.confirmed, now)
    return created
  })
}

/** A key's new note and texts. Languages the input leaves out keep theirs. */
export function updateKey(
  db: DatabaseSync,
  projectId: string,
  locales: string[],
  key: string,
  input: KeyInput,
  now = Date.now(),
) {
  transaction(db, () => {
    db.prepare(
      'UPDATE translation_keys SET note = ?, updated_at = ? WHERE project_id = ? AND key = ?',
    ).run(input.note, now, projectId, key)
    writeTexts(db, projectId, locales, key, input.texts, input.confirmed, now)
  })
}

export function deleteKey(db: DatabaseSync, projectId: string, key: string) {
  db.prepare('DELETE FROM translation_keys WHERE project_id = ? AND key = ?').run(projectId, key)
}

/** Writes one language file into the project: keys it does not have yet are added. Returns how
 *  many keys were added and how many texts changed. */
export function importTexts(
  db: DatabaseSync,
  projectId: string,
  locales: string[],
  locale: string,
  strings: Record<string, string>,
  now = Date.now(),
) {
  return transaction(db, () => {
    const add = db.prepare(
      `INSERT OR IGNORE INTO translation_keys (project_id, key, created_at, updated_at)
      VALUES (?, ?, ?, ?)`,
    )
    let added = 0
    let changed = 0
    for (const [key, text] of Object.entries(strings)) {
      added += Number(add.run(projectId, key, now, now).changes)
      changed += writeTexts(db, projectId, locales, key, { [locale]: text }, [], now)
    }
    return { added, changed }
  })
}

/** Stores a key's texts by language and returns how many changed. The source's text is kept as it
 *  is; a translation also keeps the source text it was written for, so a later change to the
 *  source marks it stale. A translation that is not changed or confirmed keeps the source it had.
 *  An empty text removes it. Languages the project does not have are left out. */
function writeTexts(
  db: DatabaseSync,
  projectId: string,
  locales: string[],
  key: string,
  texts: Record<string, string>,
  confirmed: string[],
  now: number,
) {
  const before = getKey(db, projectId, key)?.texts ?? {}
  const source = locales[0]!
  const original = texts[source] ?? before[source]?.text ?? ''
  const save = db.prepare(
    `INSERT INTO translation_texts (project_id, key, locale, text, based_on, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (project_id, key, locale) DO UPDATE
    SET text = excluded.text, based_on = excluded.based_on, updated_at = excluded.updated_at`,
  )
  const remove = db.prepare(
    'DELETE FROM translation_texts WHERE project_id = ? AND key = ? AND locale = ?',
  )
  let changed = 0
  for (const [locale, text] of Object.entries(texts)) {
    if (!locales.includes(locale)) continue
    if (text === '') {
      changed += Number(remove.run(projectId, key, locale).changes)
      continue
    }
    if (text === before[locale]?.text && !confirmed.includes(locale)) continue
    save.run(projectId, key, locale, text, locale === source ? null : original, now)
    changed++
  }
  return changed
}

// ── Publishing

/** Each language's texts by key, as a publish would freeze them now. */
export function snapshot(db: DatabaseSync, projectId: string, locales: string[]): Snapshot {
  const out: Snapshot = Object.fromEntries(locales.map((locale) => [locale, {}]))
  const rows = db
    .prepare('SELECT key, locale, text FROM translation_texts WHERE project_id = ? ORDER BY key')
    .all(projectId) as unknown as { key: string; locale: string; text: string }[]
  for (const row of rows) if (out[row.locale]) out[row.locale]![row.key] = row.text
  return out
}

/** Freezes the live languages' texts as they are: the API delivers them until the next publish. */
export function publish(db: DatabaseSync, projectId: string, locales: string[], now = Date.now()) {
  db.prepare(
    `UPDATE translation_projects SET published = ?, version = version + 1, published_at = ?
    WHERE project_id = ?`,
  ).run(JSON.stringify(snapshot(db, projectId, locales)), now, projectId)
}

/** Whether the live languages or their texts differ from what was last published; before the
 *  first publish, whether there is any text to publish. */
export function isUnpublished(db: DatabaseSync, projectId: string, space: Space) {
  const now = snapshot(db, projectId, space.live)
  if (!space.published) return Object.values(now).some((texts) => Object.keys(texts).length)
  return JSON.stringify(now) !== JSON.stringify(space.published)
}
