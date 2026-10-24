import type { DatabaseSync } from 'node:sqlite'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { LOCALE } from '../../../../../../shared/contracts'
import { keysDeclaration } from '../../../../../core/declarations'
import { getVersionTexts, snapshot } from '../../../../../core/translations'
import { answerCached, requireTranslationToken } from '../../../../../utils/linguitas'

/** A version's files: `<locale>.json`, its texts in that language, and `keys.d.ts`, its keys
 *  typed for a site's `t()`. A version never changes, so they are cached for good. `draft` is the
 *  keys as they are now, for a developer's build, with the build token. */
export default defineEventHandler((event) => {
  const db = nexitasDatabase()
  const id = getRouterParam(event, 'project') ?? ''
  const version = getRouterParam(event, 'version') ?? ''
  const file = getRouterParam(event, 'file') ?? ''
  const notFound = () =>
    createError({ statusCode: 404, statusMessage: 'This version has no such file.' })

  if (version === 'draft') {
    const { space } = requireTranslationToken(event)
    if (file !== 'keys.d.ts') throw notFound()
    setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    const source = snapshot(db, id, [space.source])[space.source]!
    return keysDeclaration(source, 'the draft')
  }
  const number = /^[1-9]\d{0,8}$/.test(version) ? Number(version) : 0
  if (!number) throw notFound()
  if (file === 'keys.d.ts') {
    // A version's source is its first language: a publish freezes the source first.
    const source = firstLocale(db, id, number)
    const texts = source ? getVersionTexts(db, id, number, source) : null
    if (!texts) throw notFound()
    setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    return answerCached(event, keysDeclaration(texts, `version ${number}`), 'immutable')
  }
  const locale = file.endsWith('.json') ? file.slice(0, -5) : ''
  const texts = LOCALE.test(locale) ? getVersionTexts(db, id, number, locale) : null
  if (!texts) throw notFound()
  return answerCached(event, texts, 'immutable')
})

function firstLocale(db: DatabaseSync, id: string, version: number) {
  const row = db
    .prepare(
      `SELECT json_extract(locales, '$[0]') AS locale FROM translation_versions
      WHERE project_id = ? AND version = ?`,
    )
    .get(id, version) as { locale: string | null } | undefined
  return row?.locale ?? null
}
