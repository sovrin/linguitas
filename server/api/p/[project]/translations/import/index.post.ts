import { announceChange } from '#nexitas/server/utils/changes'
import { invalid } from '#nexitas/server/utils/invalid'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { importApplySchema } from '../../../../../../shared/contracts'
import { applyImport } from '../../../../../core/translations'
import { translationSpace } from '../../../../../utils/linguitas'

/** Writes what the owner picked from a preview: keys, notes and texts, in one transaction. */
export default defineEventHandler(async (event) => {
  const { project, space } = translationSpace(event)
  const body = importApplySchema.safeParse(await readBody(event))
  if (!body.success) throw invalid(body.error)
  const unknown = body.data.entries.find(
    (entry) => entry.locale !== null && !space.locales.includes(entry.locale),
  )
  if (unknown)
    throw createError({
      statusCode: 400,
      statusMessage: `Add ${unknown.locale} to the project's languages first.`,
    })
  const result = applyImport(nexitasDatabase(), project.id, space.locales, body.data.entries)
  announceChange()
  return result
})
