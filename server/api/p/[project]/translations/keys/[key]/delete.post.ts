import { announceChange } from '#nexitas/server/utils/changes'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { deleteKey } from '../../../../../../core/translations'
import { routeKey, translationSpace } from '../../../../../../utils/linguitas'

/** Deletes the key with its texts. Sites keep it until the next publish. */
export default defineEventHandler((event) => {
  const { project } = translationSpace(event)
  deleteKey(nexitasDatabase(), project.id, routeKey(event, project.id).key)
  announceChange()
  return { ok: true }
})
