import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SYNC_VERSION } from '../../shared/contracts'
// The served files are plain JavaScript; the tests run them as sites do.
import * as client from '../../public/v1/translations/client.js'
import {
  check,
  loadParsers,
  mode,
  scanSource,
  VERSION,
} from '../../public/v1/translations/sync.mjs'

const parsers = await loadParsers(resolve(import.meta.dirname, '../..'))

describe('sync', () => {
  it('names the version linguitas announces', () => {
    expect(VERSION).toBe(SYNC_VERSION)
  })

  it('finds every literal key in a Vue file, and what is not one', () => {
    const source = `<script setup lang="ts">
import { t } from '~/linguitas/client'
const title = t('export.title')
const nav = t(\`nav.\${item}\`)
function other(t: (key: string) => string) {
  return t('not.ours')
}
</script>

<template>
  <h1 :title="t('a.title')">{{ t('a.heading', { n: count }) }}</h1>
  <p v-if="ok">{{ yes ? t('a.yes') : t(\`a.no\`) }}</p>
  <li v-for="item in t('a.list').split(',')" :key="item">{{ item }}</li>
  <button @click="open = true; go(t(name))">{{ t('a b') }}</button>
</template>`
    const { uses, violations } = scanSource(parsers, 'App.vue', source, 'linguitas/client')
    expect(uses).toEqual([
      { key: 'export.title', line: 3 },
      { key: 'a.title', line: 11 },
      { key: 'a.heading', line: 11 },
      { key: 'a.yes', line: 12 },
      { key: 'a.no', line: 12 },
      { key: 'a.list', line: 13 },
    ])
    expect(violations.map((v) => v.line)).toEqual([4, 14, 14])
    expect(violations[2]!.why).toBe("'a b' is not a key")
  })

  it('counts only a t imported from the client, renamed or not', () => {
    const mine = `import { t as tr } from '../utils/i18n.ts'\nexport const a = tr('a.b')\nconst t = (k) => k\nt(x)`
    expect(scanSource(parsers, 'a.ts', mine, 'utils/i18n')).toEqual({
      uses: [{ key: 'a.b', line: 2 }],
      violations: [],
    })
    const other = `import { t } from 'some-library'\nt(dynamic)`
    expect(scanSource(parsers, 'b.ts', other, 'linguitas/client')).toEqual({
      uses: [],
      violations: [],
    })
  })

  it('fails on missing keys, telling a draft from a key nobody made', () => {
    const uses = [
      { key: 'a', at: 'x.ts:1' },
      { key: 'b', at: 'x.ts:2' },
      { key: 'c', at: 'x.ts:3' },
      { key: 'c', at: 'y.ts:9' },
    ]
    expect(check(uses, [], new Set(['a']), new Set(['b']))).toEqual([
      "x.ts:2: 'b' exists only as a draft. Publish it in linguitas.",
      "x.ts:3: 'c' does not exist. Create it in linguitas.",
    ])
    expect(check(uses.slice(0, 1), [{ at: 'z.ts:4', why: 'w' }], new Set(['a']))).toEqual([
      'z.ts:4: w',
    ])
  })
})

describe('client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('falls back to the source and fills placeholders', () => {
    client.start(
      {
        version: 1,
        source: 'en',
        texts: { en: { hi: 'Hi {name}', bye: 'Bye' }, de: { hi: 'Hallo {{name}}' } },
      },
      { locale: 'de' },
    )
    expect(client.t('hi', { name: 'Ada' })).toBe('Hallo Ada')
    expect(client.t('bye')).toBe('Bye')
    expect(client.t('hi')).toBe('Hallo {{name}}')
    expect(client.t('gone')).toBe('gone')
  })

  it('swaps in a newer version and tells its listeners', async () => {
    client.start(
      { version: 1, source: 'en', texts: { en: { hi: 'Hi' }, de: { hi: 'Hallo' } } },
      { locale: 'de' },
    )
    const files: Record<string, unknown> = {
      'https://x/v1/translations/p': { version: 2, source: 'en', locales: ['en', 'de'] },
      'https://x/v1/translations/p/2/en.json': { hi: 'Hello' },
      'https://x/v1/translations/p/2/de.json': { hi: 'Servus' },
    }
    vi.stubGlobal('fetch', async (url: string) => ({
      ok: url in files,
      json: async () => files[url],
    }))
    const changed = new Promise<void>((done) => client.subscribe(done))
    const stop = client.watch({ url: 'https://x/v1/translations/p/' })
    await changed
    stop()
    expect(client.t('hi')).toBe('Servus')
  })

  it('builds without linguitas, and reports only with the token', () => {
    const named = { url: 'https://nexitas.example', project: 'sonotas' }
    expect(mode({}, false)).toEqual({ online: false, report: false })
    expect(mode({}, true)).toEqual({ online: false, report: false })
    expect(mode(named, true)).toEqual({ online: true, report: false })
    expect(mode({ ...named, token: 'lt_x', consumer: 'web' }, true)).toEqual({
      online: true,
      report: true,
    })
    expect(mode({ ...named, token: 'lt_x', consumer: 'web' }, false).report).toBe(false)
    expect(mode({ ...named, token: 'lt_x', draft: true }, false)).toEqual({
      online: true,
      report: false,
    })
    expect(mode({ draft: true }, false).error).toMatch(/LINGUITAS_URL/)
    expect(mode({ ...named, token: 'lt_x', draft: true }, true).error).toMatch(/development/)
  })
})
