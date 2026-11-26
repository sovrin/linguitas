import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { LOCALE } from '#self/shared/contracts'
import { getManifest, getVersionTexts } from '#self/server/core/translations'
import { answerCached } from '#self/server/utils/linguitas'

/** One language's texts of the current version, by key. A language that was not published is a
 *  404. A site that caches should read the version's own file (`/<version>/<locale>.json`). */
export default defineEventHandler((event) => {
  const db = nexitasDatabase()
  const id = getRouterParam(event, 'project') ?? ''
  const locale = getRouterParam(event, 'locale') ?? ''
  const manifest = LOCALE.test(locale) ? getManifest(db, id) : null
  const texts = manifest?.version ? getVersionTexts(db, id, manifest.version, locale) : null
  if (!texts)
    throw createError({ statusCode: 404, statusMessage: 'This language is not published.' })
  return answerCached(event, texts, 'no-cache')
})
