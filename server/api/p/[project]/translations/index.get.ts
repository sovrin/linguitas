import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import type { TranslationSpace } from '../../../../../shared/contracts'
import { isUnpublished, listKeys } from '../../../../core/translations'
import { translationSpace } from '../../../../utils/linguitas'

/** The project's languages, every key with its texts, and how they stand against the publish. */
export default defineEventHandler((event): TranslationSpace => {
  const { project, space } = translationSpace(event)
  const db = nexitasDatabase()
  return {
    projectId: project.id,
    name: project.name,
    token: space.token,
    source: space.source,
    locales: space.locales,
    live: space.live,
    delivered: Object.keys(space.published ?? {}),
    keys: listKeys(db, project.id),
    version: space.version,
    publishedAt: space.publishedAt,
    unpublished: isUnpublished(db, project.id, space),
  }
})
