import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '#nexitas/server/core/database'
import { createProject } from '#nexitas/server/core/projects'
import { audit, changeSchema, keyInputSchema, type ChangeInput } from '#self/shared/contracts'
import { linguitas } from '#self/server/core/module'
import {
  addLocale,
  createKey,
  createSpace,
  getKey,
  getSpace,
  listKeys,
  setLive,
  snapshot,
  updateKey,
} from '#self/server/core/translations'
import {
  applyChangeset,
  ChangeRefused,
  checkChangeset,
  createChangeset,
  deleteChangeset,
  dropChange,
  getChangeset,
  listChangesets,
  pendingAdds,
  saveChanges,
  withChangeset,
} from '#self/server/core/changesets'
import { saveReport } from '#self/server/core/usage'

const dirs: string[] = []
const dbs: DatabaseSync[] = []
afterEach(() => {
  for (const db of dbs.splice(0)) if (db.isOpen) db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const locales = ['en', 'de']
const input = (texts: Record<string, string>) => keyInputSchema.parse({ texts })
const change = (value: unknown) => changeSchema.parse(value) as ChangeInput

function database() {
  const dir = mkdtempSync(join(tmpdir(), 'linguitas-test-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'test.sqlite'), [linguitas])
  dbs.push(db)
  createProject(db, { id: 'sonotas', name: 'sonotas', origins: ['https://sonotas.example'] })
  createSpace(db, 'sonotas')
  addLocale(db, 'sonotas', 'de')
  setLive(db, 'sonotas', 'de', true)
  createKey(db, 'sonotas', locales, 'pay', input({ en: 'Pay', de: 'Bezahlen' }))
  createKey(db, 'sonotas', locales, 'old', input({ en: 'Old', de: 'Alt' }))
  createChangeset(db, 'sonotas', 'feat/checkout', 'The new checkout')
  return db
}

const space = (db: DatabaseSync) => getSpace(db, 'sonotas')!
const save = (db: DatabaseSync, ...changes: unknown[]) =>
  saveChanges(db, 'sonotas', space(db), 'feat/checkout', changes.map(change))
const ops = (db: DatabaseSync) =>
  getChangeset(db, 'sonotas', 'feat/checkout')!.changes.map((c) => [c.key, c.op, c.texts])

describe('changesets', () => {
  it('starts once by name, and lists open ones first', () => {
    const db = database()
    expect(createChangeset(db, 'sonotas', 'feat/checkout')).toBe(false)
    expect(createChangeset(db, 'sonotas', 'fix-typo')).toBe(true)
    save(db, { op: 'add', key: 'checkout.title', texts: { en: 'Checkout' } })
    applyChangeset(db, 'sonotas', space(db), 'feat/checkout')
    expect(listChangesets(db, 'sonotas').map((c) => [c.name, c.changes, c.pending])).toEqual([
      ['fix-typo', 0, 0],
      ['feat/checkout', 1, 0],
    ])
  })

  it('keeps one change per key, merging texts that come a language at a time', () => {
    const db = database()
    save(db, { op: 'add', key: 'checkout.title', texts: { en: 'Checkout' } })
    save(db, { op: 'update', key: 'checkout.title', texts: { de: 'Kasse' } })
    save(db, { op: 'update', key: 'pay', texts: { en: 'Pay now' } })
    save(db, { op: 'update', key: 'pay', texts: { de: 'Jetzt bezahlen' } })
    expect(ops(db)).toEqual([
      ['checkout.title', 'add', { en: 'Checkout', de: 'Kasse' }],
      ['pay', 'update', { en: 'Pay now', de: 'Jetzt bezahlen' }],
    ])
    // The draft and sites see none of it.
    expect(getKey(db, 'sonotas', 'checkout.title')).toBeNull()
    expect(getKey(db, 'sonotas', 'pay')!.texts.en!.text).toBe('Pay')
  })

  it('keeps only what an update changes, and drops a change that changes nothing', () => {
    const db = database()
    save(db, { op: 'update', key: 'pay', texts: { en: 'Pay now', de: 'Bezahlen' } })
    expect(ops(db)).toEqual([['pay', 'update', { en: 'Pay now' }]])
    save(db, { op: 'update', key: 'pay', texts: { en: 'Pay' } })
    expect(ops(db)).toEqual([])
  })

  it('takes an add back when the key is removed, and replaces an update with a removal', () => {
    const db = database()
    save(db, { op: 'add', key: 'checkout.title', texts: { en: 'Checkout' } })
    save(db, { op: 'remove', key: 'checkout.title' })
    save(db, { op: 'update', key: 'old', texts: { en: 'Older' } })
    save(db, { op: 'remove', key: 'old' })
    expect(ops(db)).toEqual([['old', 'remove', {}]])
    expect(dropChange(db, 'sonotas', 'feat/checkout', 'old')).toBe(true)
    expect(ops(db)).toEqual([])
  })

  it('refuses what cannot be, all or none', () => {
    const db = database()
    const refused = (...changes: unknown[]) =>
      expect(() => save(db, ...changes)).toThrow(ChangeRefused)
    refused({ op: 'add', key: 'pay', texts: { en: 'Pay' } })
    refused({ op: 'update', key: 'nope', texts: { en: 'Nope' } })
    refused({ op: 'remove', key: 'nope' })
    refused({ op: 'update', key: 'pay', texts: { fr: 'Payer' } })
    refused(
      { op: 'add', key: 'checkout.title', texts: { en: 'Checkout' } },
      { op: 'remove', key: 'nope' },
    )
    expect(ops(db)).toEqual([])
    expect(() =>
      saveChanges(db, 'sonotas', space(db), 'nope', [change({ op: 'remove', key: 'pay' })]),
    ).toThrow(ChangeRefused)
  })

  it('applies every change at once; publishing stays a step of its own', () => {
    const db = database()
    save(
      db,
      {
        op: 'add',
        key: 'checkout.title',
        note: 'Page title',
        texts: { en: 'Checkout', de: 'Kasse' },
      },
      { op: 'update', key: 'pay', texts: { en: 'Pay now' } },
      { op: 'remove', key: 'old' },
    )
    const result = applyChangeset(db, 'sonotas', space(db), 'feat/checkout')
    expect(result).toEqual({ applied: ['checkout.title', 'old', 'pay'], conflicts: [], held: [] })
    expect(listKeys(db, 'sonotas').map((k) => k.key)).toEqual(['checkout.title', 'pay'])
    expect(getKey(db, 'sonotas', 'checkout.title')!.note).toBe('Page title')
    // The update changed the source, so the translation it left alone is stale, as anywhere.
    expect(audit(getKey(db, 'sonotas', 'pay')!, 'de', 'en')).toContain('stale')
    expect(getChangeset(db, 'sonotas', 'feat/checkout')!.appliedAt).not.toBeNull()
    expect(() => save(db, { op: 'update', key: 'pay', texts: { en: 'Pay' } })).toThrow(
      ChangeRefused,
    )
    expect(space(db).published).toBeNull()
  })

  it('applies a new source with its translations up to date', () => {
    const db = database()
    save(db, { op: 'update', key: 'pay', texts: { en: 'Pay now', de: 'Jetzt bezahlen' } })
    applyChangeset(db, 'sonotas', space(db), 'feat/checkout')
    expect(audit(getKey(db, 'sonotas', 'pay')!, 'de', 'en')).toEqual([])
  })

  it('applies nothing while the draft changed under a change', () => {
    const db = database()
    save(
      db,
      { op: 'add', key: 'checkout.title', texts: { en: 'Checkout' } },
      { op: 'update', key: 'pay', texts: { en: 'Pay now' } },
    )
    createKey(db, 'sonotas', locales, 'checkout.title', input({ en: 'Kasse' }))
    updateKey(db, 'sonotas', locales, 'pay', input({ en: 'Pay!' }))
    const result = applyChangeset(db, 'sonotas', space(db), 'feat/checkout')
    expect(result.applied).toEqual([])
    expect(result.conflicts.map((c) => c.key)).toEqual(['checkout.title', 'pay'])
    expect(getKey(db, 'sonotas', 'pay')!.texts.en!.text).toBe('Pay!')
    // A text the change leaves alone may change in the draft: no conflict.
    const db2 = database()
    save(db2, { op: 'update', key: 'pay', texts: { en: 'Pay now' } })
    updateKey(db2, 'sonotas', locales, 'pay', input({ de: 'Zahlen' }))
    expect(checkChangeset(db2, 'sonotas', getChangeset(db2, 'sonotas', 'feat/checkout')!)).toEqual({
      conflicts: [],
      held: [],
    })
  })

  it("holds back removing a key sites' code still uses, until it is unused or forced", () => {
    const db = database()
    saveReport(db, 'sonotas', { consumer: 'web', version: 0, sync: 2, keys: ['old'] })
    save(
      db,
      { op: 'add', key: 'checkout.title', texts: { en: 'Checkout' } },
      { op: 'remove', key: 'old' },
    )
    const first = applyChangeset(db, 'sonotas', space(db), 'feat/checkout')
    expect(first.applied).toEqual(['checkout.title'])
    expect(first.held).toEqual([{ key: 'old', consumers: ['web'] }])
    expect(getKey(db, 'sonotas', 'old')).not.toBeNull()
    expect(getChangeset(db, 'sonotas', 'feat/checkout')!.appliedAt).toBeNull()
    // The new code went live and no longer asks for it.
    saveReport(db, 'sonotas', { consumer: 'web', version: 1, sync: 2, keys: ['checkout.title'] })
    expect(applyChangeset(db, 'sonotas', space(db), 'feat/checkout').applied).toEqual(['old'])
    expect(getKey(db, 'sonotas', 'old')).toBeNull()
    expect(getChangeset(db, 'sonotas', 'feat/checkout')!.appliedAt).not.toBeNull()

    const forced = database()
    saveReport(forced, 'sonotas', { consumer: 'web', version: 0, sync: 2, keys: ['old'] })
    saveChanges(forced, 'sonotas', space(forced), 'feat/checkout', [
      change({ op: 'remove', key: 'old' }),
    ])
    const result = applyChangeset(forced, 'sonotas', space(forced), 'feat/checkout', {
      removeUsed: true,
    })
    expect(result.applied).toEqual(['old'])
  })

  it('previews the draft with the changeset laid over it, and keeps nothing', () => {
    const db = database()
    save(
      db,
      { op: 'add', key: 'checkout.title', texts: { en: 'Checkout' } },
      { op: 'remove', key: 'old' },
    )
    const changeset = getChangeset(db, 'sonotas', 'feat/checkout')!
    const preview = withChangeset(db, 'sonotas', space(db), changeset, () =>
      snapshot(db, 'sonotas', ['en']),
    )
    expect(preview).toEqual({ en: { 'checkout.title': 'Checkout', pay: 'Pay' } })
    expect(snapshot(db, 'sonotas', ['en'])).toEqual({ en: { old: 'Old', pay: 'Pay' } })
    expect(pendingAdds(db, 'sonotas')).toEqual({ 'checkout.title': ['feat/checkout'] })
  })

  it('deletes a changeset with its changes; what it applied stays', () => {
    const db = database()
    save(db, { op: 'add', key: 'checkout.title', texts: { en: 'Checkout' } })
    applyChangeset(db, 'sonotas', space(db), 'feat/checkout')
    expect(deleteChangeset(db, 'sonotas', 'feat/checkout')).toBe(true)
    expect(getChangeset(db, 'sonotas', 'feat/checkout')).toBeNull()
    expect(getKey(db, 'sonotas', 'checkout.title')).not.toBeNull()
  })
})
