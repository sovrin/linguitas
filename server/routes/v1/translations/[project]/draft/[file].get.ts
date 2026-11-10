import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { keysDeclaration } from '#self/server/core/declarations'
import { snapshot } from '#self/server/core/translations'
import { requireTranslationToken } from '#self/server/utils/linguitas'

/** The draft's files, as they are now, for a developer's build, with the build token: its keys
 *  typed for a site's `t()` (keys.d.ts), or every language in one file (texts.json). Its own
 *  route: /draft takes the path segment from [version]. */
export default defineEventHandler((event) => {
  const { project, space } = requireTranslationToken(event)
  const db = nexitasDatabase()
  const file = getRouterParam(event, 'file')
  if (file === 'texts.json')
    return {
      version: space.version,
      source: space.source,
      texts: snapshot(db, project.id, space.locales),
    }
  if (file !== 'keys.d.ts')
    throw createError({ statusCode: 404, statusMessage: 'The draft has no such file.' })
  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  const source = snapshot(db, project.id, [space.source])[space.source]!
  return keysDeclaration(source, 'the draft')
})
