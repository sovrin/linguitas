import { getProject } from '#nexitas/server/core/projects'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { SYNC_VERSION } from '../../../../../shared/contracts'
import { getManifest } from '../../../../core/translations'
import { answerCached } from '../../../../utils/linguitas'

/** The project, the languages it delivers and which version they come from. Sites check it for a
 *  new version: unchanged, it is a 304. `sync` is the current sync script's version. */
export default defineEventHandler((event) => {
  const db = nexitasDatabase()
  const id = getRouterParam(event, 'project') ?? ''
  const manifest = getManifest(db, id)
  const project = manifest && getProject(db, id)
  if (!manifest || !project)
    throw createError({ statusCode: 404, statusMessage: 'There are no translations here.' })
  return answerCached(
    event,
    {
      slug: project.id,
      name: project.name,
      source: manifest.source,
      // What sites can read now: a language added or put live since is not here until a publish.
      locales: manifest.locales,
      version: manifest.version,
      publishedAt: manifest.publishedAt ? new Date(manifest.publishedAt).toISOString() : null,
      sync: SYNC_VERSION,
    },
    'no-cache',
  )
})
