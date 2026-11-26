import { announceChange } from '#nexitas/server/utils/changes'
import { invalid } from '#nexitas/server/utils/invalid'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { changesSchema } from '#self/shared/contracts'
import { ChangeRefused, saveChanges } from '#self/server/core/changesets'
import { routeChangeset, translationSpace } from '#self/server/utils/linguitas'

/** Writes changes into the changeset, all or none; the draft stays as it is. */
export default defineEventHandler(async (event) => {
  const { project, space } = translationSpace(event)
  const changeset = routeChangeset(event, project.id)
  const body = changesSchema.safeParse(await readBody(event))
  if (!body.success) throw invalid(body.error)
  try {
    saveChanges(nexitasDatabase(), project.id, space, changeset.name, body.data.changes)
  } catch (error) {
    if (error instanceof ChangeRefused)
      throw createError({ statusCode: 409, statusMessage: error.message })
    throw error
  }
  announceChange()
  return { ok: true }
})
