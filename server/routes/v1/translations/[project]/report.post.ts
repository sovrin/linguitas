import { createLimiter } from '#nexitas/server/core/limits'
import { announceChange } from '#nexitas/server/utils/changes'
import { invalid } from '#nexitas/server/utils/invalid'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { reportSchema } from '../../../../../shared/contracts'
import { listConsumers, MAX_CONSUMERS, saveReport } from '../../../../core/usage'
import { requireTranslationToken } from '../../../../utils/linguitas'

// A build reports once per CI run; this keeps a leaked token from flooding the database.
const perProject = createLimiter(60, 60 * 60 * 1000)

/** A site's build reports the keys its code uses, with the build token. It replaces that site's
 *  last report. Answers how many of them do not exist. */
export default defineEventHandler(async (event) => {
  const { project } = requireTranslationToken(event)
  const parsed = reportSchema.safeParse(await readBody(event))
  if (!parsed.success) throw invalid(parsed.error)
  if (!perProject.hit(project.id))
    throw createError({ statusCode: 429, statusMessage: 'Too many reports. Try again later.' })
  const db = nexitasDatabase()
  const saved = saveReport(db, project.id, parsed.data)
  if (saved === 'full')
    throw createError({
      statusCode: 409,
      statusMessage: `This project has ${MAX_CONSUMERS} consumers already. Forget one under Sites on the Translations page first.`,
    })
  if (saved === 'changed') announceChange()
  const consumer = listConsumers(db, project.id).find((c) => c.name === parsed.data.consumer)
  return { missing: consumer?.missing ?? 0 }
})
