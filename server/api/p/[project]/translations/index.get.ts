import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import {
  CHECKS,
  audit,
  countProblems,
  type Check,
  type TranslationSpace,
} from '../../../../../shared/contracts'
import { isUnpublished, listKeys, listVersions } from '../../../../core/translations'
import { listConsumers, listUsage } from '../../../../core/usage'
import { translationSpace } from '../../../../utils/linguitas'

/** The project's languages, how its keys stand, summed up, and how they stand against the publish.
 *  The keys themselves come a level at a time from tree.get.ts. */
export default defineEventHandler((event): TranslationSpace => {
  const { project, space } = translationSpace(event)
  const db = nexitasDatabase()
  const keys = listKeys(db, project.id)
  const usage = listUsage(db, project.id)
  const known = new Set(keys.map((key) => key.key))
  const checks = Object.fromEntries(
    (Object.keys(CHECKS) as Check[]).map((check) => [
      check,
      keys.filter((key) =>
        space.locales.some((locale) => audit(key, locale, space.source).includes(check)),
      ).length,
    ]),
  ) as Record<Check, number>
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
    problems: countProblems(keys, space.live),
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
