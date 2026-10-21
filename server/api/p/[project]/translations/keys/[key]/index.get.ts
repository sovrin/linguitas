import { routeKey, translationSpace } from '../../../../../../utils/linguitas'

export default defineEventHandler((event) => {
  const { project, space } = translationSpace(event)
  return { locales: space.locales, key: routeKey(event, project.id) }
})
