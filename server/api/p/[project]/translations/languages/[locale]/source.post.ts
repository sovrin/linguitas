import { announceChange } from '#nexitas/server/utils/changes'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { setSource } from '../../../../../../core/translations'
import { routeLocale, translationSpace } from '../../../../../../utils/linguitas'

/** Makes a live language the source every other one is translated from. */
export default defineEventHandler((event) => {
  const { project, space } = translationSpace(event)
  const locale = routeLocale(event, space)
  if (!space.live.includes(locale))
    throw createError({ statusCode: 409, statusMessage: 'Only a live language can be the source.' })
  if (locale !== space.source) setSource(nexitasDatabase(), project.id, space, locale)
  announceChange()
  return { source: locale }
})
