import { placeholders } from '../../shared/contracts'

/** keys.d.ts for a site: every key of `source` (one language's texts by key) with the placeholders
 *  its text has. It extends the `Keys` of the client beside it, so `t()` takes only these keys,
 *  and the values a key's placeholders need. */
export function keysDeclaration(source: Record<string, string>, label: string) {
  const entries = Object.keys(source)
    .sort()
    .map((key) => {
      const params = placeholders(source[key]!).map((name) => `${JSON.stringify(name)}: Value`)
      return `    ${JSON.stringify(key)}: ${params.length ? `{ ${params.join('; ')} }` : '{}'}`
    })
  return [
    `// Written by linguitas from ${label}. Run the sync script to refresh it; don't edit it.`,
    `import type { Value } from './client.js'`,
    ``,
    `declare module './client.js' {`,
    `  interface Keys {`,
    ...entries,
    `  }`,
    `}`,
    ``,
  ].join('\n')
}
