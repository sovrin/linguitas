import { requireTranslationToken } from '../../../../utils/linguitas'

/** One language's published texts by key. A language that was not published is a 404. */
export default defineEventHandler((event) => {
  const { space } = requireTranslationToken(event)
  const locale = getRouterParam(event, 'locale') ?? ''
  const texts =
    space.published && Object.hasOwn(space.published, locale) ? space.published[locale] : null
  if (!texts)
    throw createError({ statusCode: 404, statusMessage: 'This language is not published.' })
  return texts
})
