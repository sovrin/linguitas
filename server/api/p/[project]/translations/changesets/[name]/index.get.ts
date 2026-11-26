import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import type { ChangesetView, TextKey } from '#self/shared/contracts'
import { checkChangeset, withChangeset } from '#self/server/core/changesets'
import { getKey } from '#self/server/core/translations'
import { routeChangeset, translationSpace } from '#self/server/utils/linguitas'

/** A changeset with the keys it touches as they are and as applying would leave them, and what
 *  stands in the way of applying it. */
export default defineEventHandler((event): ChangesetView => {
  const { project, space } = translationSpace(event)
  const db = nexitasDatabase()
  const changeset = routeChangeset(event, project.id)
  const read = () =>
    Object.fromEntries(
      changeset.changes.map((change) => [change.key, getKey(db, project.id, change.key)]),
    ) as Record<string, TextKey | null>
  return {
    changeset,
    source: space.source,
    locales: space.locales,
    before: read(),
    after: withChangeset(db, project.id, space, changeset, read),
    ...checkChangeset(db, project.id, changeset),
  }
})
