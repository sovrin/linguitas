import { announceChange } from '#nexitas/server/utils/changes'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { getSpace, publish } from '#self/server/core/translations'
import { translationSpace } from '#self/server/utils/linguitas'

/** Freezes the texts as they are now; the API delivers them from here on. */
export default defineEventHandler((event) => {
  const { project, space } = translationSpace(event)
  const db = nexitasDatabase()
  publish(db, project.id, space.live)
  announceChange()
  return { version: getSpace(db, project.id)!.version }
})
