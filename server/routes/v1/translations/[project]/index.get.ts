import { requireTranslationToken } from '../../../../utils/linguitas'

/** The project, the languages it delivers and which publish they come from. */
export default defineEventHandler((event) => {
  const { project, space } = requireTranslationToken(event)
  return {
    slug: project.id,
    name: project.name,
    source: space.source,
    // What sites can read now: a language added or put live since is not here until a publish.
    locales: Object.keys(space.published ?? {}),
    version: space.version,
    publishedAt: space.publishedAt ? new Date(space.publishedAt).toISOString() : null,
  }
})
