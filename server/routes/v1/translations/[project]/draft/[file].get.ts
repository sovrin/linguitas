import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { keysDeclaration } from '../../../../../core/declarations'
import { snapshot } from '../../../../../core/translations'
import { requireTranslationToken } from '../../../../../utils/linguitas'

/** The draft's keys typed for a site's `t()`, as they are now: for a developer's build, with the
 *  build token. Its own route: /draft takes the path segment from [version]. */
export default defineEventHandler((event) => {
  const { project, space } = requireTranslationToken(event)
  if (getRouterParam(event, 'file') !== 'keys.d.ts')
    throw createError({ statusCode: 404, statusMessage: 'The draft has no such file.' })
  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  const source = snapshot(nexitasDatabase(), project.id, [space.source])[space.source]!
  return keysDeclaration(source, 'the draft')
})
