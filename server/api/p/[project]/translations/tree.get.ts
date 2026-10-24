import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { CHECKS } from '../../../../../shared/contracts'
import { filterKeys, treeRows, type Filter } from '../../../../../shared/tree'
import { listKeys } from '../../../../core/translations'
import { listUsage } from '../../../../core/usage'
import { translationSpace } from '../../../../utils/linguitas'

/** The key tree's top level and the children of each `open` node, nothing deeper: the page draws
 *  only what is unfolded. `check` and `q` narrow the keys first, as the page's filters. */
export default defineEventHandler((event) => {
  const { project, space } = translationSpace(event)
  const query = getQuery(event)
  const open = ([] as unknown[]).concat(query.open ?? []).filter((path) => typeof path === 'string')
  const check = query.check
  const filter: Filter =
    check === 'unused' || (typeof check === 'string' && check in CHECKS) ? (check as Filter) : 'all'
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 200) : ''
  const db = nexitasDatabase()
  const keys = filterKeys(listKeys(db, project.id), {
    filter,
    q,
    locales: space.locales,
    used: new Set(Object.keys(listUsage(db, project.id))),
  })
  // shortcut: every request reads all keys and builds the whole tree; fine for thousands of keys,
  // cache the tree per publish state if a project grows far past that.
  return treeRows(keys, open.slice(0, 500) as string[], space.locales)
})
