import { announceChange } from '#nexitas/server/utils/changes'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { rotateToken } from '../../../../core/translations'
import { translationSpace } from '../../../../utils/linguitas'

/** Replaces the read token; the old one stops working at once. */
export default defineEventHandler((event) => {
  rotateToken(nexitasDatabase(), translationSpace(event).project.id)
  announceChange()
  return { ok: true }
})
