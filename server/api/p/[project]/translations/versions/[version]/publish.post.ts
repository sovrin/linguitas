import { announceChange } from '#nexitas/server/utils/changes'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { getSpace, republish } from '../../../../../../core/translations'
import { translationSpace } from '../../../../../../utils/linguitas'

/** Publishes an earlier version's texts again, as the next version: the way back from a publish
 *  that should not have gone out. */
export default defineEventHandler((event) => {
  const { project } = translationSpace(event)
  const db = nexitasDatabase()
  const version = Number(getRouterParam(event, 'version'))
  if (!Number.isInteger(version) || !republish(db, project.id, version))
    throw createError({ statusCode: 404, statusMessage: 'There is no such version.' })
  announceChange()
  return { version: getSpace(db, project.id)!.version }
})
