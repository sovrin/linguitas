import { announceChange } from '#nexitas/server/utils/changes'
import { invalid } from '#nexitas/server/utils/invalid'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { newKeySchema } from '../../../../../../shared/contracts'
import { createKey, getKey } from '../../../../../core/translations'
import { translationSpace } from '../../../../../utils/linguitas'

export default defineEventHandler(async (event) => {
  const { project, space } = translationSpace(event)
  const body = newKeySchema.safeParse(await readBody(event))
  if (!body.success) throw invalid(body.error)
  const db = nexitasDatabase()
  if (!createKey(db, project.id, space.locales, body.data.key, body.data))
    throw createError({ statusCode: 409, statusMessage: 'This key exists already.' })
  announceChange()
  setResponseStatus(event, 201)
  return getKey(db, project.id, body.data.key)
})
