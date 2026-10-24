import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '#nexitas/server/core/database'
import { keyTree, keysUnder } from '../../app/lib/translations'
import { createProject, deleteProject } from '#nexitas/server/core/projects'
import {
  audit,
  countProblems,
  flatten,
  keyInputSchema,
  localeInputSchema,
  placeholders,
} from '../../shared/contracts'
import {
  addLocale,
  createKey,
  createSpace,
  getKey,
  getSpace,
  importTexts,
  isUnpublished,
  listKeys,
  publish,
  removeLocale,
  rotateToken,
  setLive,
  setSource,
  updateKey,
} from '../../server/core/translations'
import { linguitas } from '../../server/core/module'

const dirs: string[] = []
const dbs: DatabaseSync[] = []
afterEach(() => {
  for (const db of dbs.splice(0)) if (db.isOpen) db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const locales = ['en', 'de']

function database() {
  const dir = mkdtempSync(join(tmpdir(), 'linguitas-test-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'test.sqlite'), [linguitas])
  dbs.push(db)
  createProject(db, { id: 'sonotas', name: 'sonotas', origins: ['https://sonotas.example'] })
  createSpace(db, 'sonotas')
  addLocale(db, 'sonotas', 'de')
  setLive(db, 'sonotas', 'de', true)
  return db
}

const input = (texts: Record<string, string>, confirmed: string[] = []) =>
  keyInputSchema.parse({ texts, confirmed })

describe('translations', () => {
  it('starts once per project, with a token that can be replaced', () => {
    const db = database()
    expect(createSpace(db, 'sonotas')).toBe(false)
    const token = getSpace(db, 'sonotas')!.token
    expect(token).toMatch(/^lt_/)
    rotateToken(db, 'sonotas')
    expect(getSpace(db, 'sonotas')!.token).not.toBe(token)
  })

  it('marks a translation stale when its source changes, until it is changed or confirmed', () => {
    const db = database()
    expect(createKey(db, 'sonotas', locales, 'pay', input({ en: 'Pay', de: 'Bezahlen' }))).toBe(
      true,
    )
    expect(createKey(db, 'sonotas', locales, 'pay', input({}))).toBe(false)
    expect(audit(getKey(db, 'sonotas', 'pay')!, 'de', 'en')).toEqual([])

    updateKey(db, 'sonotas', locales, 'pay', input({ en: 'Pay now', de: 'Bezahlen' }))
    expect(audit(getKey(db, 'sonotas', 'pay')!, 'de', 'en')).toEqual(['stale'])

    updateKey(db, 'sonotas', locales, 'pay', input({ en: 'Pay now', de: 'Bezahlen' }, ['de']))
    expect(audit(getKey(db, 'sonotas', 'pay')!, 'de', 'en')).toEqual([])

    // An empty text removes it; a language the project lacks is left out.
    updateKey(db, 'sonotas', locales, 'pay', input({ de: '', fr: 'Payer' }))
    const key = getKey(db, 'sonotas', 'pay')!
    expect(Object.keys(key.texts)).toEqual(['en'])
    expect(audit(key, 'de', 'en')).toEqual(['missing'])
    expect(countProblems([key], locales)).toBe(1)
  })

  it('checks placeholders and texts left as the source', () => {
    const key = {
      key: 'hi',
      note: '',
      updatedAt: 0,
      texts: {
        en: { text: 'Hi {name}, {{count}} new', basedOn: null, updatedAt: 0 },
        de: { text: 'Hallo {name}', basedOn: 'Hi {name}, {{count}} new', updatedAt: 0 },
        fr: { text: 'Hi {name}, {{count}} new', basedOn: 'Hi {name}, {{count}} new', updatedAt: 0 },
      },
    }
    expect(placeholders(key.texts.en.text)).toEqual(['count', 'name'])
    expect(audit(key, 'de', 'en')).toEqual(['placeholders'])
    expect(audit(key, 'fr', 'en')).toEqual(['unchanged'])
    expect(countProblems([key], ['en', 'fr'])).toBe(0)
  })

  it('imports nested files, adding the keys it lacks', () => {
    const db = database()
    const { strings, skipped } = flatten({
      checkout: { pay: 'Pay', total: 'Total' },
      count: 3,
      'bad key': 'x',
    })
    expect(strings).toEqual({ 'checkout.pay': 'Pay', 'checkout.total': 'Total' })
    expect(skipped).toEqual(['count', 'bad key'])
    expect(importTexts(db, 'sonotas', locales, 'en', strings)).toEqual({ added: 2, changed: 2 })
    expect(importTexts(db, 'sonotas', locales, 'de', { 'checkout.pay': 'Bezahlen' })).toEqual({
      added: 0,
      changed: 1,
    })
    expect(getKey(db, 'sonotas', 'checkout.pay')!.texts.de!.basedOn).toBe('Pay')
    expect(listKeys(db, 'sonotas').map((key) => key.key)).toEqual([
      'checkout.pay',
      'checkout.total',
    ])
  })

  it('delivers what was published until the next publish', () => {
    const db = database()
    expect(isUnpublished(db, 'sonotas', getSpace(db, 'sonotas')!)).toBe(false)
    createKey(db, 'sonotas', locales, 'pay', input({ en: 'Pay', de: 'Bezahlen' }))
    expect(isUnpublished(db, 'sonotas', getSpace(db, 'sonotas')!)).toBe(true)
    publish(db, 'sonotas', locales)
    const space = getSpace(db, 'sonotas')!
    expect(space.version).toBe(1)
    expect(space.published).toEqual({ en: { pay: 'Pay' }, de: { pay: 'Bezahlen' } })
    expect(isUnpublished(db, 'sonotas', space)).toBe(false)
    updateKey(db, 'sonotas', locales, 'pay', input({ en: 'Pay now' }))
    expect(isUnpublished(db, 'sonotas', getSpace(db, 'sonotas')!)).toBe(true)
  })

  it('delivers a new language only once it is live, and keeps the texts of a removed one', () => {
    const db = database()
    expect(addLocale(db, 'sonotas', 'de')).toBe(false)
    expect(addLocale(db, 'sonotas', 'fr')).toBe(true)
    let space = getSpace(db, 'sonotas')!
    expect(space.locales).toEqual(['en', 'de', 'fr'])
    expect(space.live).toEqual(['en', 'de'])

    createKey(db, 'sonotas', space.locales, 'pay', input({ en: 'Pay', fr: 'Payer' }))
    publish(db, 'sonotas', space.live)
    expect(Object.keys(getSpace(db, 'sonotas')!.published!)).toEqual(['en', 'de'])

    removeLocale(db, 'sonotas', 'fr')
    expect(getSpace(db, 'sonotas')!.locales).toEqual(['en', 'de'])
    addLocale(db, 'sonotas', 'fr')
    expect(getKey(db, 'sonotas', 'pay')!.texts.fr!.text).toBe('Payer')

    // Taken offline, a language stays delivered until the next publish.
    setLive(db, 'sonotas', 'de', false)
    space = getSpace(db, 'sonotas')!
    expect(Object.keys(space.published!)).toEqual(['en', 'de'])
    expect(isUnpublished(db, 'sonotas', space)).toBe(true)

    expect(localeInputSchema.safeParse({ locale: 'pt-BR' }).success).toBe(true)
    expect(localeInputSchema.safeParse({ locale: 'English' }).success).toBe(false)
  })

  it('keeps up-to-date translations up to date when the source changes', () => {
    const db = database()
    addLocale(db, 'sonotas', 'fr')
    setLive(db, 'sonotas', 'fr', true)
    const locales = ['en', 'de', 'fr']
    createKey(db, 'sonotas', locales, 'pay', input({ en: 'Pay', de: 'Bezahlen', fr: 'Payer' }))
    createKey(db, 'sonotas', locales, 'total', input({ en: 'Total', de: 'Summe', fr: 'Total' }))
    // de falls behind on total: it was written for a source that has changed since.
    updateKey(db, 'sonotas', locales, 'total', input({ en: 'Sum' }))

    setSource(db, 'sonotas', getSpace(db, 'sonotas')!, 'de')
    const space = getSpace(db, 'sonotas')!
    expect(space.source).toBe('de')
    expect(space.locales).toEqual(['de', 'en', 'fr'])
    const pay = getKey(db, 'sonotas', 'pay')!
    expect(space.locales.map((l) => audit(pay, l, 'de'))).toEqual([[], [], []])
    const total = getKey(db, 'sonotas', 'total')!
    expect(audit(total, 'de', 'de')).toEqual([])
    expect(audit(total, 'en', 'de')).toEqual(['stale'])
    expect(audit(total, 'fr', 'de')).toEqual(['stale'])
  })

  it('goes with its project', () => {
    const db = database()
    createKey(db, 'sonotas', locales, 'pay', input({ en: 'Pay' }))
    deleteProject(db, 'sonotas', [linguitas])
    expect(getSpace(db, 'sonotas')).toBeNull()
    expect(db.prepare('SELECT COUNT(*) AS n FROM translation_texts').get()).toEqual({ n: 0 })
  })
})

describe('key tree', () => {
  const key = (name: string) => ({ key: name, note: '', texts: {}, updatedAt: 0 })

  it('nests at the dots, keeping a key that also has keys below it', () => {
    const tree = keyTree([key('general.foo'), key('general.foo.bar'), key('general.baz')])
    expect(tree.map((node) => node.label)).toEqual(['general'])
    const general = tree[0]!
    expect(general.key).toBeUndefined()
    // A branch before a key, as folders before files.
    expect(general.children.map((node) => node.label)).toEqual(['foo', 'baz'])
    const foo = general.children[0]!
    expect(foo.key?.key).toBe('general.foo')
    expect(foo.children.map((node) => node.path)).toEqual(['general.foo.bar'])
    expect(keysUnder(general).map((k) => k.key)).toEqual([
      'general.foo',
      'general.foo.bar',
      'general.baz',
    ])
  })

  it('folds a chain that holds nothing else into one row, after the branches', () => {
    const tree = keyTree([key('checkout.form.errors.email'), key('nav.home'), key('nav.episodes')])
    expect(tree.map((node) => [node.label, node.path])).toEqual([
      ['nav', 'nav'],
      ['checkout.form.errors.email', 'checkout.form.errors.email'],
    ])
  })
})
