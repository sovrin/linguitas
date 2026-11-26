import { announceChange } from '#nexitas/server/utils/changes'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { isKey } from '#self/shared/contracts'
import { dropChange } from '#self/server/core/changesets'
import { routeChangeset, translationSpace } from '#self/server/utils/linguitas'

/** Drops the change for one key that waits to be applied. */
export default defineEventHandler(async (event) => {
  const { project } = translationSpace(event)
  const changeset = routeChangeset(event, project.id)
  const { key } = ((await readBody(event)) ?? {}) as { key?: unknown }
  if (!isKey(key) || !dropChange(nexitasDatabase(), project.id, changeset.name, key))
    throw createError({ statusCode: 404, statusMessage: 'No change waits for this key.' })
  announceChange()
  return { ok: true }
})
