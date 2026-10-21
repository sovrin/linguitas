import { announceChange } from '#nexitas/server/utils/changes'
import { invalid } from '#nexitas/server/utils/invalid'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { localeInputSchema } from '../../../../../../shared/contracts'
import { addLocale } from '../../../../../core/translations'
import { translationSpace } from '../../../../../utils/linguitas'

/** Adds a language as a draft; sites get it only once it is live and published. */
export default defineEventHandler(async (event) => {
  const { project } = translationSpace(event)
  const body = localeInputSchema.safeParse(await readBody(event))
  if (!body.success) throw invalid(body.error)
  if (!addLocale(nexitasDatabase(), project.id, body.data.locale))
    throw createError({ statusCode: 409, statusMessage: 'The project has this language already.' })
  announceChange()
  setResponseStatus(event, 201)
  return body.data
})
