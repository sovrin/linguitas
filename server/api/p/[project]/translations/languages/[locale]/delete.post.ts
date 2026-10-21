import { announceChange } from '#nexitas/server/utils/changes'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { removeLocale } from '../../../../../../core/translations'
import { routeLocale, translationSpace } from '../../../../../../utils/linguitas'

/** Takes a draft language out; its texts stay until it is added again. A live one has to be taken
 *  offline first, so no site loses a language in one step. */
export default defineEventHandler((event) => {
  const { project, space } = translationSpace(event)
  const locale = routeLocale(event, space)
  if (locale === space.source)
    throw createError({ statusCode: 409, statusMessage: 'The source cannot be removed.' })
  if (space.live.includes(locale))
    throw createError({ statusCode: 409, statusMessage: 'Take the language offline first.' })
  removeLocale(nexitasDatabase(), project.id, locale)
  announceChange()
  return { ok: true }
})
