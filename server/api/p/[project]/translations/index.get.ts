import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { CHECKS, audit, isProblem, type Check, type TranslationSpace } from '#self/shared/contracts'
import { isUnpublished, listKeys, listVersions } from '#self/server/core/translations'
import { listConsumers, listUsage } from '#self/server/core/usage'
import { translationSpace } from '#self/server/utils/linguitas'

/** The project's languages, how its keys stand, summed up, and how they stand against the publish.
 *  The keys themselves come a level at a time from tree.get.ts. */
export default defineEventHandler((event): TranslationSpace => {
  const { project, space } = translationSpace(event)
  const db = nexitasDatabase()
  const keys = listKeys(db, project.id)
  const usage = listUsage(db, project.id)
  const known = new Set(keys.map((key) => key.key))
  // One audit per key and language, every count from it: the page refreshes on every change.
  const checks = Object.fromEntries(
    (Object.keys(CHECKS) as Check[]).map((check) => [check, 0]),
  ) as Record<Check, number>
  let problems = 0
  for (const key of keys) {
    const found = new Set<Check>()
    let problem = false
    for (const locale of space.locales) {
      const own = audit(key, locale, space.source)
      for (const check of own) found.add(check)
      if (!problem && space.live.includes(locale) && own.some(isProblem)) problem = true
    }
    for (const check of found) if (check in checks) checks[check]++
    if (problem) problems++
  }
  return {
    token: space.token,
    mcpToken: space.mcpToken,
    source: space.source,
    locales: space.locales,
    live: space.live,
    delivered: Object.keys(space.published ?? {}),
    keyCount: keys.length,
    filled: Object.fromEntries(
      space.locales.map((locale) => [locale, keys.filter((key) => key.texts[locale]).length]),
    ),
    checks,
    problems,
    unused: keys.filter((key) => !usage[key.key]).length,
    asked: Object.entries(usage)
      .filter(([key]) => !known.has(key))
      .map(([key, consumers]) => ({ key, consumers })),
    version: space.version,
    publishedAt: space.publishedAt,
    unpublished: isUnpublished(db, project.id, space),
    versions: listVersions(db, project.id),
    consumers: listConsumers(db, project.id),
  }
})
