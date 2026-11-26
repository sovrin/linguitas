import { announceChange } from '#nexitas/server/utils/changes'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { rotateToken } from '#self/server/core/translations'
import { translationSpace } from '#self/server/utils/linguitas'

/** Replaces the read token; the old one stops working at once. */
export default defineEventHandler((event) => {
  rotateToken(nexitasDatabase(), translationSpace(event).project.id)
  announceChange()
  return { ok: true }
})
