import { announceChange } from '#nexitas/server/utils/changes'
import { invalid } from '#nexitas/server/utils/invalid'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { keyInputSchema } from '../../../../../../../shared/contracts'
import { getKey, updateKey } from '../../../../../../core/translations'
import { routeKey, translationSpace } from '../../../../../../utils/linguitas'

/** A new note and texts. The key stays: sites look the texts up by it. */
export default defineEventHandler(async (event) => {
  const { project, space } = translationSpace(event)
  const { key } = routeKey(event, project.id)
  const body = keyInputSchema.safeParse(await readBody(event))
  if (!body.success) throw invalid(body.error)
  const db = nexitasDatabase()
  updateKey(db, project.id, space.locales, key, body.data)
  announceChange()
  return getKey(db, project.id, key)
})
