import type { H3Event } from 'h3'
import { tokensMatch } from '#nexitas/server/core/auth'
import { getProject } from '#nexitas/server/core/projects'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { requestProject } from '#nexitas/server/utils/projects'
import { isKey } from '../../shared/contracts'
import { getKey, getSpace, type Space } from '../core/translations'

/** The request's project with its translations, or a 404: the panel and the translations page read
 *  that as not started yet. */
export function translationSpace(event: H3Event) {
  const project = requestProject(event)
  const space = getSpace(nexitasDatabase(), project.id)
  if (!space)
    throw createError({ statusCode: 404, statusMessage: 'This project has no translations.' })
  return { project, space }
}

/** The key a route names. Anything that is not a key cannot exist, so it is a 404 too. */
export function routeKey(event: H3Event, projectId: string) {
  const name = getRouterParam(event, 'key') ?? ''
  const key = isKey(name) ? getKey(nexitasDatabase(), projectId, name) : null
  if (!key) throw createError({ statusCode: 404, statusMessage: 'There is no such key.' })
  return key
}

/** The language a route names, if the project has it. */
export function routeLocale(event: H3Event, space: Space) {
  const locale = getRouterParam(event, 'locale') ?? ''
  if (!space.locales.includes(locale))
    throw createError({ statusCode: 404, statusMessage: 'The project has no such language.' })
  return locale
}

/** The project of a delivery request and its translations, if its bearer token matches. An
 *  unknown project and a wrong token look the same. */
export function requireTranslationToken(event: H3Event) {
  const db = nexitasDatabase()
  const id = getRouterParam(event, 'project') ?? ''
  const space = getSpace(db, id)
  const token = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!space || !tokensMatch(token, space.token)) {
    setHeader(event, 'WWW-Authenticate', 'Bearer')
    throw createError({ statusCode: 401, statusMessage: 'Invalid token.' })
  }
  return { project: getProject(db, id)!, space }
}
