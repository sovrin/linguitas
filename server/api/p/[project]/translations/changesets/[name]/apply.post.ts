import { announceChange } from '#nexitas/server/utils/changes'
import { invalid } from '#nexitas/server/utils/invalid'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { applySchema } from '#self/shared/contracts'
import { applyChangeset } from '#self/server/core/changesets'
import { routeChangeset, translationSpace } from '#self/server/utils/linguitas'

/** Applies the changeset to the draft, all at once, or nothing when anything conflicts. Sites get
 *  it with the next publish. */
export default defineEventHandler(async (event) => {
  const { project, space } = translationSpace(event)
  const changeset = routeChangeset(event, project.id)
  const body = applySchema.safeParse((await readBody(event)) ?? {})
  if (!body.success) throw invalid(body.error)
  const result = applyChangeset(nexitasDatabase(), project.id, space, changeset.name, body.data)
  if (result.conflicts.length)
    throw createError({
      statusCode: 409,
      statusMessage: 'The draft changed under this changeset: resolve the conflicts first.',
      data: result,
    })
  announceChange()
  return result
})
