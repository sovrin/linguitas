import { announceChange } from '#nexitas/server/utils/changes'
import { invalid } from '#nexitas/server/utils/invalid'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { flatten, importSchema } from '../../../../../shared/contracts'
import { importTexts } from '../../../../core/translations'
import { translationSpace } from '../../../../utils/linguitas'

/** Writes one language file, flat or nested, into the project. Keys it lacks are added. */
export default defineEventHandler(async (event) => {
  const { project, space } = translationSpace(event)
  const body = importSchema.safeParse(await readBody(event))
  if (!body.success) throw invalid(body.error)
  if (!space.locales.includes(body.data.locale))
    throw createError({
      statusCode: 400,
      statusMessage: `Add ${body.data.locale} to the project's languages first.`,
    })
  const { strings, skipped } = flatten(body.data.strings)
  const result = importTexts(
    nexitasDatabase(),
    project.id,
    space.locales,
    body.data.locale,
    strings,
  )
  announceChange()
  return { ...result, skipped }
})
