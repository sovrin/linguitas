import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '#nexitas/server/core/database'
import { createProject } from '#nexitas/server/core/projects'
import { keyInputSchema, reportSchema } from '../../shared/contracts'
import { keysDeclaration } from '../../server/core/declarations'
import { linguitas } from '../../server/core/module'
import {
  addLocale,
  createKey,
  createSpace,
  deleteKey,
  getManifest,
  getVersionTexts,
  listVersions,
  publish,
  republish,
  setLive,
  updateKey,
} from '../../server/core/translations'
import {
  listConsumers,
  listUsage,
  MAX_CONSUMERS,
  removeConsumer,
  saveReport,
} from '../../server/core/usage'

const dirs: string[] = []
const dbs: DatabaseSync[] = []
afterEach(() => {
  for (const db of dbs.splice(0)) if (db.isOpen) db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const locales = ['en', 'de']
const input = (texts: Record<string, string>) => keyInputSchema.parse({ texts })

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

describe('versions', () => {
  it('keeps every publish, and publishes an old one again as the next', () => {
    const db = database()
    expect(getManifest(db, 'sonotas')).toEqual({
      source: 'en',
      locales: [],
      version: 0,
      publishedAt: null,
    })
    createKey(db, 'sonotas', locales, 'pay', input({ en: 'Pay', de: 'Bezahlen' }))
    publish(db, 'sonotas', locales, 1000)
    updateKey(db, 'sonotas', locales, 'pay', input({ en: 'Pay now' }))
    publish(db, 'sonotas', locales, 2000)

    expect(getManifest(db, 'sonotas')).toMatchObject({ locales: ['en', 'de'], version: 2 })
    expect(getVersionTexts(db, 'sonotas', 1, 'en')).toEqual({ pay: 'Pay' })
    expect(getVersionTexts(db, 'sonotas', 2, 'en')).toEqual({ pay: 'Pay now' })
    expect(getVersionTexts(db, 'sonotas', 2, 'fr')).toBeNull()
    expect(getVersionTexts(db, 'sonotas', 3, 'en')).toBeNull()

    expect(republish(db, 'sonotas', 1, 3000)).toBe(true)
    expect(republish(db, 'sonotas', 9)).toBe(false)
    expect(getVersionTexts(db, 'sonotas', 3, 'en')).toEqual({ pay: 'Pay' })
    expect(listVersions(db, 'sonotas').map((v) => v.version)).toEqual([3, 2, 1])
  })
})

describe('usage', () => {
  const report = (consumer: string, keys: string[]) =>
    reportSchema.parse({ consumer, version: 1, sync: 1, keys })

  it("replaces a consumer's keys with each report, and counts what does not exist", () => {
    const db = database()
    createKey(db, 'sonotas', locales, 'pay', input({ en: 'Pay' }))
    createKey(db, 'sonotas', locales, 'total', input({ en: 'Total' }))
    saveReport(db, 'sonotas', report('web', ['pay', 'ghost']), 1000)
    saveReport(db, 'sonotas', report('ios', ['pay']), 2000)
    expect(listUsage(db, 'sonotas')).toEqual({ ghost: ['web'], pay: ['ios', 'web'] })
    expect(listConsumers(db, 'sonotas').map((c) => [c.name, c.missing])).toEqual([
      ['ios', 0],
      ['web', 1],
    ])

    saveReport(db, 'sonotas', report('web', ['total']), 3000)
    expect(listUsage(db, 'sonotas')).toEqual({ pay: ['ios'], total: ['web'] })

    // A deleted key someone still uses is asked for again.
    deleteKey(db, 'sonotas', 'pay')
    expect(listConsumers(db, 'sonotas').find((c) => c.name === 'ios')!.missing).toBe(1)

    removeConsumer(db, 'sonotas', 'ios')
    expect(listUsage(db, 'sonotas')).toEqual({ total: ['web'] })
  })

  it('keeps a report that changed nothing quietly, and caps how many consumers there are', () => {
    const db = database()
    expect(saveReport(db, 'sonotas', report('web', ['pay', 'total']), 1000)).toBe('changed')
    expect(saveReport(db, 'sonotas', report('web', ['total', 'pay', 'pay']), 2000)).toBe(
      'unchanged',
    )
    expect(listConsumers(db, 'sonotas')[0]!.reportedAt).toBe(2000)
    expect(saveReport(db, 'sonotas', report('web', ['pay']), 3000)).toBe('changed')

    for (let i = 1; i < MAX_CONSUMERS; i++) saveReport(db, 'sonotas', report(`site-${i}`, []))
    expect(saveReport(db, 'sonotas', report('one-more', ['pay']))).toBe('full')
    expect(listConsumers(db, 'sonotas')).toHaveLength(MAX_CONSUMERS)
    expect(saveReport(db, 'sonotas', report('web', ['total']))).toBe('changed')
  })

  it('accepts only names and keys it can store', () => {
    expect(
      reportSchema.safeParse({ consumer: 'Web App', version: 1, sync: 1, keys: [] }).success,
    ).toBe(false)
    expect(
      reportSchema.safeParse({ consumer: 'web', version: 1, sync: 1, keys: ['a b'] }).success,
    ).toBe(false)
  })
})

describe('keys.d.ts', () => {
  it('types each key with the placeholders its source text has', () => {
    const out = keysDeclaration(
      { 'b.done': 'Took {minutes} min, {{count}} files', 'a.title': 'Export' },
      'version 3',
    )
    expect(out).toContain('from version 3')
    expect(out).toContain(`declare module './client.js'`)
    const a = out.indexOf('"a.title": {}')
    const b = out.indexOf('"b.done": { "count": Value; "minutes": Value }')
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
  })
})
