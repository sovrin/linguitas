import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { isKey } from '../../../../../../../shared/contracts'
import { getKey } from '../../../../../../core/translations'
import { listConsumers, listUsage } from '../../../../../../core/usage'
import { translationSpace } from '../../../../../../utils/linguitas'

/** A key with its texts, and the sites whose code uses it: null until a site has reported. A
 *  valid name that is no key yet (a node in between, checkout.form) answers with `key: null`, so
 *  it can be given texts; anything else that is not a key is a 404. */
export default defineEventHandler((event) => {
  const { project, space } = translationSpace(event)
  const name = getRouterParam(event, 'key') ?? ''
  if (!isKey(name)) throw createError({ statusCode: 404, statusMessage: 'There is no such key.' })
  const db = nexitasDatabase()
  const reported = listConsumers(db, project.id).length > 0
  return {
    locales: space.locales,
    key: getKey(db, project.id, name),
    usedBy: reported ? (listUsage(db, project.id)[name] ?? []) : null,
  }
})
