import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '#nexitas/server/core/database'
import { createProject } from '#nexitas/server/core/projects'
import { linguitas } from '../../server/core/module'
import { instructions, translationTools } from '../../server/core/tools'
import {
  addLocale,
  createSpace,
  getKey,
  getSpace,
  setMcpAccess,
} from '../../server/core/translations'
import { answerMessage } from '../../server/utils/mcp'

const dirs: string[] = []
const dbs: DatabaseSync[] = []
afterEach(() => {
  for (const db of dbs.splice(0)) if (db.isOpen) db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function database() {
  const dir = mkdtempSync(join(tmpdir(), 'linguitas-test-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'test.sqlite'), [linguitas])
  dbs.push(db)
  createProject(db, { id: 'sonotas', name: 'sonotas', origins: ['https://sonotas.example'] })
  createSpace(db, 'sonotas')
  addLocale(db, 'sonotas', 'de')
  return db
}

function server(db: DatabaseSync) {
  let changes = 0
  const mcp = {
    name: 'linguitas',
    instructions,
    tools: translationTools(db, 'sonotas', () => changes++),
  }
  let id = 0
  const call = (name: string, args: unknown) => {
    const answer = answerMessage(
      { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } },
      mcp,
    ) as { result: { content: { text: string }[]; isError: boolean } }
    const { text } = answer.result.content[0]!
    return answer.result.isError ? { error: text } : JSON.parse(text)
  }
  return { mcp, call, changes: () => changes }
}

describe('mcp', () => {
  it('speaks the protocol: initialize, tools/list, notifications, unknown methods', () => {
    const { mcp } = server(database())
    expect(
      answerMessage(
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
        mcp,
      ),
    ).toMatchObject({
      id: 1,
      result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } },
    })
    expect(
      answerMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: {} }, mcp),
    ).toMatchObject({
      result: { protocolVersion: '2025-11-25' },
    })
    const listed = answerMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, mcp) as {
      result: { tools: { name: string; inputSchema: { type: string } }[] }
    }
    expect(listed.result.tools.map((tool) => tool.name)).toEqual([
      'list_keys',
      'get_key',
      'save_keys',
      'translate',
      'add_language',
    ])
    expect(listed.result.tools.every((tool) => tool.inputSchema.type === 'object')).toBe(true)
    expect(answerMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, mcp)).toBeNull()
    expect(answerMessage({ jsonrpc: '2.0', id: 4, method: 'resources/list' }, mcp)).toMatchObject({
      error: { code: -32601 },
    })
    expect(answerMessage([1], mcp)).toMatchObject({ error: { code: -32700 } })
  })

  it('creates and updates keys, keeping the note and languages left out', () => {
    const db = database()
    const { call, changes } = server(db)
    expect(
      call('save_keys', {
        keys: [
          {
            key: 'export.done',
            note: 'Toast after an export',
            texts: { en: 'Done in {minutes} min' },
          },
        ],
      }),
    ).toEqual([{ key: 'export.done', saved: 'created', checks: { de: ['missing'] } }])
    expect(
      call('save_keys', {
        keys: [{ key: 'export.done', texts: { de: 'Fertig in {minuten} Min.' } }],
      }),
    ).toEqual([{ key: 'export.done', saved: 'updated', checks: { de: ['placeholders'] } }])
    const key = getKey(db, 'sonotas', 'export.done')!
    expect(key.note).toBe('Toast after an export')
    expect(key.texts.en!.text).toBe('Done in {minutes} min')
    expect(changes()).toBe(2)
    expect(call('save_keys', { keys: [{ key: 'a', texts: { fr: 'x' } }] }).error).toMatch(
      /no language fr\. add_language/,
    )
    expect(call('save_keys', { keys: [{ key: 'bad key', texts: {} }] }).error).toBeDefined()
  })

  it('gives what a translation needs: the note, placeholders, the stale source and a glossary', () => {
    const db = database()
    const { call } = server(db)
    call('save_keys', {
      keys: [
        { key: 'help.close', texts: { en: 'Close', de: 'Schließen' } },
        {
          key: 'export.done',
          note: 'Toast, keep it short',
          texts: { en: 'Done in {minutes} min' },
        },
        { key: 'export.start', texts: { en: 'Export', de: 'Exportieren' } },
      ],
    })
    call('save_keys', { keys: [{ key: 'export.start', texts: { en: 'Export video' } }] })
    const brief = call('translate', { locale: 'de' })
    expect(brief.from).toBe('en')
    expect(brief.keys).toEqual([
      {
        key: 'export.done',
        note: 'Toast, keep it short',
        source: 'Done in {minutes} min',
        placeholders: ['minutes'],
      },
      {
        key: 'export.start',
        source: 'Export video',
        placeholders: [],
        current: 'Exportieren',
        writtenFor: 'Export',
      },
    ])
    expect(brief.glossary).toEqual([{ en: 'Close', de: 'Schließen' }])
    expect(call('translate', { locale: 'de', keys: ['help.close'] }).keys).toHaveLength(1)
    expect(call('translate', { locale: 'en' }).error).toMatch(/source language/)
    expect(call('translate', { locale: 'de', keys: ['nope'] }).error).toMatch(/no key nope/)
  })

  it('adds a language as a draft', () => {
    const db = database()
    const { call } = server(db)
    expect(call('add_language', { locale: 'fr' })).toEqual({ locale: 'fr', added: true })
    expect(getSpace(db, 'sonotas')!.live).toEqual(['en'])
    expect(call('list_keys', { locale: 'fr' }).languages).toContainEqual({
      locale: 'fr',
      live: false,
    })
  })

  it('has no token until the owner turns access on, and a new one each time', () => {
    const db = database()
    expect(getSpace(db, 'sonotas')!.mcpToken).toBeNull()
    setMcpAccess(db, 'sonotas', true)
    const first = getSpace(db, 'sonotas')!.mcpToken
    expect(first).toMatch(/^ltm_/)
    setMcpAccess(db, 'sonotas', true)
    expect(getSpace(db, 'sonotas')!.mcpToken).not.toBe(first)
    setMcpAccess(db, 'sonotas', false)
    expect(getSpace(db, 'sonotas')!.mcpToken).toBeNull()
  })
})
