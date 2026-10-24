import { announceChange } from '#nexitas/server/utils/changes'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { removeConsumer } from '../../../../../../core/usage'
import { translationSpace } from '../../../../../../utils/linguitas'

/** Forgets a site that no longer reports, so its keys stop counting as used. Its next report
 *  brings it back. */
export default defineEventHandler((event) => {
  const { project } = translationSpace(event)
  removeConsumer(nexitasDatabase(), project.id, getRouterParam(event, 'consumer') ?? '')
  announceChange()
  return { ok: true }
})
