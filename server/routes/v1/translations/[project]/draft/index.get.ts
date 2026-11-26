import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { pendingAdds, withChangeset } from '#self/server/core/changesets'
import { snapshot } from '#self/server/core/translations'
import { queryChangeset, requireTranslationToken } from '#self/server/utils/linguitas'

/** The texts as they are now, published or not, in every language worked in: what a developer's
 *  build reads with `--draft`, with a feature's changeset laid over it (?changeset=). Never what a
 *  site in production gets. `changesets` names the open changesets adding each key, so sync can
 *  tell a build what its code waits for. */
export default defineEventHandler((event) => {
  const { project, space } = requireTranslationToken(event)
  const db = nexitasDatabase()
  const changeset = queryChangeset(event, project.id)
  const read = () => snapshot(db, project.id, space.locales)
  return {
    version: space.version,
    source: space.source,
    texts: changeset ? withChangeset(db, project.id, space, changeset, read) : read(),
    changesets: pendingAdds(db, project.id),
  }
})
