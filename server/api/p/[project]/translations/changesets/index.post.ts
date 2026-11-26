import { announceChange } from '#nexitas/server/utils/changes'
import { invalid } from '#nexitas/server/utils/invalid'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { newChangesetSchema } from '#self/shared/contracts'
import { createChangeset, getChangeset } from '#self/server/core/changesets'
import { translationSpace } from '#self/server/utils/linguitas'

/** Starts a changeset for a feature's key changes. */
export default defineEventHandler(async (event) => {
  const { project } = translationSpace(event)
  const body = newChangesetSchema.safeParse(await readBody(event))
  if (!body.success) throw invalid(body.error)
  const db = nexitasDatabase()
  if (!createChangeset(db, project.id, body.data.name, body.data.note))
    throw createError({
      statusCode: 409,
      statusMessage: 'A changeset by this name exists already.',
    })
  announceChange()
  setResponseStatus(event, 201)
  return getChangeset(db, project.id, body.data.name)
})
