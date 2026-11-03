import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { getManifest, getVersionTexts } from '../../../../core/translations'
import { answerCached } from '../../../../utils/linguitas'

/** Every published language of the current version in one file, as a site commits it and its
 *  client reads it: `{ version, source, texts: { [locale]: { [key]: text } } }`. A site that
 *  needs no sync script downloads just this (and the client). */
export default defineEventHandler((event) => {
  const db = nexitasDatabase()
  const id = getRouterParam(event, 'project') ?? ''
  const manifest = getManifest(db, id)
  if (!manifest?.version)
    throw createError({ statusCode: 404, statusMessage: 'Nothing is published yet.' })
  const texts = Object.fromEntries(
    manifest.locales.map((locale) => [locale, getVersionTexts(db, id, manifest.version, locale)]),
  )
  return answerCached(
    event,
    { version: manifest.version, source: manifest.source, texts },
    'no-cache',
  )
})
