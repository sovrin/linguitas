import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { listChangesets } from '#self/server/core/changesets'
import { translationSpace } from '#self/server/utils/linguitas'

/** The project's changesets, open ones first. */
export default defineEventHandler((event) => {
  const { project } = translationSpace(event)
  return listChangesets(nexitasDatabase(), project.id)
})
