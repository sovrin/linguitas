import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { keysDeclaration } from '#self/server/core/declarations'
import { withChangeset } from '#self/server/core/changesets'
import { snapshot } from '#self/server/core/translations'
import { queryChangeset, requireTranslationToken } from '#self/server/utils/linguitas'

/** The draft's files, as they are now, for a developer's build, with the build token: its keys
 *  typed for a site's `t()` (keys.d.ts), or every language in one file (texts.json); with a
 *  feature's changeset laid over it (?changeset=). Its own route: /draft takes the path segment
 *  from [version]. */
export default defineEventHandler((event) => {
  const { project, space } = requireTranslationToken(event)
  const db = nexitasDatabase()
  const file = getRouterParam(event, 'file')
  if (file !== 'texts.json' && file !== 'keys.d.ts')
    throw createError({ statusCode: 404, statusMessage: 'The draft has no such file.' })
  const changeset = queryChangeset(event, project.id)
  const read = () =>
    snapshot(db, project.id, file === 'texts.json' ? space.locales : [space.source])
  const texts = changeset ? withChangeset(db, project.id, space, changeset, read) : read()
  if (file === 'texts.json') return { version: space.version, source: space.source, texts }
  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  return keysDeclaration(
    texts[space.source]!,
    changeset ? `the draft with changeset ${changeset.name}` : 'the draft',
  )
})
