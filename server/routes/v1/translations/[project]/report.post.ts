import { announceChange } from '#nexitas/server/utils/changes'
import { invalid } from '#nexitas/server/utils/invalid'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { reportSchema } from '../../../../../shared/contracts'
import { listConsumers, saveReport } from '../../../../core/usage'
import { requireTranslationToken } from '../../../../utils/linguitas'

/** A site's build reports the keys its code uses, with the build token. It replaces that site's
 *  last report. Answers how many of them do not exist. */
export default defineEventHandler(async (event) => {
  const { project } = requireTranslationToken(event)
  const parsed = reportSchema.safeParse(await readBody(event))
  if (!parsed.success) throw invalid(parsed.error)
  const db = nexitasDatabase()
  saveReport(db, project.id, parsed.data)
  announceChange()
  const consumer = listConsumers(db, project.id).find((c) => c.name === parsed.data.consumer)
  return { missing: consumer?.missing ?? 0 }
})
