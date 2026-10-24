import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { listConsumers, listUsage } from '../../../../../../core/usage'
import { routeKey, translationSpace } from '../../../../../../utils/linguitas'

/** A key with its texts, and the sites whose code uses it: null until a site has reported. */
export default defineEventHandler((event) => {
  const { project, space } = translationSpace(event)
  const key = routeKey(event, project.id)
  const db = nexitasDatabase()
  const reported = listConsumers(db, project.id).length > 0
  return {
    locales: space.locales,
    key,
    usedBy: reported ? (listUsage(db, project.id)[key.key] ?? []) : null,
  }
})
