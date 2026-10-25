import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import { getProject } from '#nexitas/server/core/projects'
import { requireBearer } from '#nexitas/server/utils/auth'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { requestProject } from '#nexitas/server/utils/projects'
import { isKey } from '../../shared/contracts'
import { getKey, getSpace, type Space } from '../core/translations'

/** The request's project with its translations, or a 404: the Translations page reads that as not
 *  started yet. */
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

/** The project of a build's request (a draft, a report) and its translations, if the bearer is
 *  the project's build token. An unknown project and a wrong token look the same. Published texts
 *  need no token: they are in every page that shows them. */
export function requireTranslationToken(event: H3Event) {
  const db = nexitasDatabase()
  const id = getRouterParam(event, 'project') ?? ''
  const space = getSpace(db, id)
  requireBearer(event, space?.token)
  return { project: getProject(db, id)!, space: space! }
}

/** Answers with `body` as JSON or text and an ETag, or with a 304 when the caller has it already.
 *  `cache` is the Cache-Control: `no-cache` for what changes on a publish (check every time, cheap
 *  when unchanged), `immutable` for a version's files, which never change. */
export function answerCached(event: H3Event, body: unknown, cache: 'no-cache' | 'immutable') {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  const etag = `"${createHash('sha1').update(text).digest('base64url').slice(0, 22)}"`
  setHeaders(event, {
    'Cache-Control': cache === 'immutable' ? 'public, max-age=31536000, immutable' : 'no-cache',
    ETag: etag,
  })
  if (getHeader(event, 'if-none-match') === etag) return sendNoContent(event, 304)
  if (typeof body !== 'string') setHeader(event, 'Content-Type', 'application/json')
  return text
}
