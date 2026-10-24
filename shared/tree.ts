import { audit, type Check, type TextKey } from './contracts'

/** One node of the key tree, split at the dots. A node can be a key with texts of its own and
 *  still have keys below it (`general.foo` and `general.foo.bar`). */
export interface KeyNode {
  /** The full path: "general.foo". */
  path: string
  /** What its row shows: the last segment, or several when a chain holds nothing else
   *  ("form.errors"). */
  label: string
  /** The key this node is, when it has texts. */
  key?: TextKey
  children: KeyNode[]
}

/** The keys as a tree, any depth: branches first, then keys, each by segment, as folders come
 *  before files. A node that is no key and has one child joins it, so a lone deep key is one row,
 *  not a staircase. */
export function keyTree(keys: readonly TextKey[]): KeyNode[] {
  const root: KeyNode = { path: '', label: '', children: [] }
  for (const key of keys) {
    let node = root
    for (const segment of key.key.split('.')) {
      const path = node.path ? `${node.path}.${segment}` : segment
      let child = node.children.find((candidate) => candidate.path === path)
      if (!child) node.children.push((child = { path, label: segment, children: [] }))
      node = child
    }
    node.key = key
  }
  const tidy = (node: KeyNode): KeyNode => {
    node.children = node.children
      .map(tidy)
      .sort(
        (a, b) =>
          Number(b.children.length > 0) - Number(a.children.length > 0) ||
          a.label.localeCompare(b.label),
      )
    const [only] = node.children
    if (node.path && !node.key && node.children.length === 1 && only)
      return { ...only, label: `${node.label}.${only.label}` }
    return node
  }
  return tidy(root).children
}

/** Every key at or below a node. */
export const keysUnder = (node: KeyNode): TextKey[] => [
  ...(node.key ? [node.key] : []),
  ...node.children.flatMap(keysUnder),
]

/** One language of one key: translated, to check (what the audit finds, bar "same as source"),
 *  or missing. */
export type State = 'done' | 'check' | 'missing'

export function stateOf(key: TextKey, locale: string, source: string): State {
  if (!key.texts[locale]) return 'missing'
  return audit(key, locale, source).some((check) => check !== 'unchanged' && check !== 'missing')
    ? 'check'
    : 'done'
}

/** One row of the tree as the page draws it: a node and what is below it, summed up, never the
 *  keys below themselves. Its children come only once it is unfolded. */
export interface TreeRow {
  path: string
  label: string
  /** The key this node is, when it has texts. */
  key?: TextKey
  /** Whether keys sit below it, so it folds. */
  branch: boolean
  /** How many keys are at or below it. */
  below: number
  /** Each language but the source: a branch shows the worst of what is below it, so a gap shows
   *  before it is unfolded. */
  states: Record<string, State>
}

/** Which keys the tree shows: every key, those with an audit finding, or those no site's code
 *  uses; a search narrows them to a key's name or its source text, ignoring case. */
export type Filter = 'all' | Check | 'unused'

export function filterKeys(
  keys: readonly TextKey[],
  { filter, q, locales, used }: { filter: Filter; q: string; locales: string[]; used: Set<string> },
) {
  const source = locales[0]!
  const term = q.toLowerCase()
  return keys.filter((key) => {
    if (
      term &&
      !key.key.toLowerCase().includes(term) &&
      !key.texts[source]?.text.toLowerCase().includes(term)
    )
      return false
    if (filter === 'all') return true
    if (filter === 'unused') return !used.has(key.key)
    return locales.some((locale) => audit(key, locale, source).includes(filter))
  })
}

/** The rows of the top level (`''`) and of each open node: their children, nothing deeper. A path
 *  that is no node (filtered away, or a step inside a joined chain) is left out. */
export function treeRows(
  keys: readonly TextKey[],
  open: readonly string[],
  locales: string[],
): Record<string, TreeRow[]> {
  const source = locales[0]!
  const targets = locales.filter((locale) => locale !== source)
  const nodes = new Map<string, KeyNode>()
  const index = (list: KeyNode[]) =>
    list.forEach((node) => {
      nodes.set(node.path, node)
      index(node.children)
    })
  const top = keyTree(keys)
  index(top)
  const row = (node: KeyNode): TreeRow => {
    const under = keysUnder(node)
    const leaf = node.key && !node.children.length ? node.key : undefined
    const states = Object.fromEntries(
      targets.map((locale): [string, State] => {
        if (leaf) return [locale, stateOf(leaf, locale, source)]
        const below = under.map((key) => stateOf(key, locale, source))
        return [
          locale,
          below.includes('missing') ? 'missing' : below.includes('check') ? 'check' : 'done',
        ]
      }),
    )
    return {
      path: node.path,
      label: node.label,
      ...(node.key ? { key: node.key } : {}),
      branch: node.children.length > 0,
      below: under.length,
      states,
    }
  }
  const rows: Record<string, TreeRow[]> = { '': top.map(row) }
  for (const path of open) {
    const node = nodes.get(path)
    if (node?.children.length) rows[path] = node.children.map(row)
  }
  return rows
}
