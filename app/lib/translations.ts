import type { TextKey } from '../../shared/contracts'

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
