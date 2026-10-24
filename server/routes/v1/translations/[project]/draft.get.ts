import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { snapshot } from '../../../../core/translations'
import { requireTranslationToken } from '../../../../utils/linguitas'

/** The texts as they are now, published or not, in every language worked in: what a developer's
 *  build reads with `--draft`. Never what a site in production gets. */
export default defineEventHandler((event) => {
  const { project, space } = requireTranslationToken(event)
  return {
    version: space.version,
    source: space.source,
    texts: snapshot(nexitasDatabase(), project.id, space.locales),
  }
})
