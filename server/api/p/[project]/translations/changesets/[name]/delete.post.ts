import { announceChange } from '#nexitas/server/utils/changes'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { deleteChangeset } from '#self/server/core/changesets'
import { routeChangeset, translationSpace } from '#self/server/utils/linguitas'

/** Deletes the changeset with its changes; what it applied stays applied. */
export default defineEventHandler((event) => {
  const { project } = translationSpace(event)
  deleteChangeset(nexitasDatabase(), project.id, routeChangeset(event, project.id).name)
  announceChange()
  return { ok: true }
})
