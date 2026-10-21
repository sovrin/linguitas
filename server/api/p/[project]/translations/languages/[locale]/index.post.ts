import { announceChange } from '#nexitas/server/utils/changes'
import { invalid } from '#nexitas/server/utils/invalid'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { liveSchema } from '../../../../../../../shared/contracts'
import { setLive } from '../../../../../../core/translations'
import { routeLocale, translationSpace } from '../../../../../../utils/linguitas'

/** Puts a language live, or takes it offline, from the next publish on. */
export default defineEventHandler(async (event) => {
  const { project, space } = translationSpace(event)
  const locale = routeLocale(event, space)
  const body = liveSchema.safeParse(await readBody(event))
  if (!body.success) throw invalid(body.error)
  if (locale === space.source && !body.data.live)
    throw createError({
      statusCode: 409,
      statusMessage: 'The source is always live. Make another language the source first.',
    })
  setLive(nexitasDatabase(), project.id, locale, body.data.live)
  announceChange()
  return { locale, ...body.data }
})
