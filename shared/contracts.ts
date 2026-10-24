// Every rule about what linguitas accepts, and every check on what it holds, lives here, shared by
// the admin pages and the server. The owner's sign-in and the projects are nexitas'.
import { z } from 'zod'
import { formatCount } from '#nexitas/app/lib/format'

/** Keys are what sites look a text up by: words joined by dots, such as checkout.pay.button. They
 *  are addresses, so they never change once made. The first character is never _ or -, which the
 *  admin's own pages (_new) start with. */
export const keySchema = z
  .string()
  .max(120)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*$/,
    'Use letters, digits, _ and -, in parts joined by dots.',
  )
export const isKey = (value: unknown): value is string => keySchema.safeParse(value).success

/** Languages by their tag: en, de, pt-BR. */
export const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/
export const localeSchema = z.string().regex(LOCALE, 'Use a language tag, such as en, de or pt-BR.')

/** A language to add, or to make the source. */
export const localeInputSchema = z.object({ locale: localeSchema }).strict()
/** Whether the next publish delivers a language. */
export const liveSchema = z.object({ live: z.boolean() }).strict()

/** What the owner writes for a key: its note, and texts by language. An empty text removes it.
 *  `confirmed` names languages whose text still fits a changed source as it is. */
export const keyInputSchema = z
  .object({
    note: z.string().trim().max(500).default(''),
    texts: z.record(localeSchema, z.string().max(10_000)).default({}),
    confirmed: z.array(localeSchema).max(50).default([]),
  })
  .strict()
export const newKeySchema = keyInputSchema.extend({ key: keySchema }).strict()
export type KeyInput = z.infer<typeof keyInputSchema>

/** A file of one language's texts, flat or nested, as i18n libraries keep them. */
export const importSchema = z
  .object({ locale: localeSchema, strings: z.record(z.string(), z.unknown()) })
  .strict()

/** One language's text for a key. */
export interface Text {
  text: string
  /** The source text this translation was written for; null for the source's own text. When the
   *  source changes, the two differ and the translation is stale. */
  basedOn: string | null
  updatedAt: number
}

export interface TextKey {
  key: string
  note: string
  /** By language; a language without a text is missing. */
  texts: Record<string, Text>
  updatedAt: number
}

/** What the audit looks for in a key's text in one language. */
export const CHECKS = {
  missing: 'Missing',
  stale: 'Source changed',
  placeholders: 'Placeholders differ',
  unchanged: 'Same as source',
} as const
export type Check = keyof typeof CHECKS

// shortcut: only {name} and {{name}} count as placeholders; add %s or :name once a site uses them.
const PLACEHOLDER = /\{+\s*([A-Za-z0-9_.]+)/g

/** The placeholder names in a text, sorted, each once. */
export function placeholders(text: string) {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1]!))].sort()
}

/** What is wrong with a key's text in one language, if anything. The source can only be missing. */
export function audit(key: TextKey, locale: string, source: string): Check[] {
  const text = key.texts[locale]
  if (!text) return ['missing']
  if (locale === source) return []
  const original = key.texts[source]?.text ?? ''
  const checks: Check[] = []
  if (text.basedOn !== original) checks.push('stale')
  if (placeholders(text.text).join() !== placeholders(original).join()) checks.push('placeholders')
  if (text.text === original) checks.push('unchanged')
  return checks
}

/** Same as source is often right ("OK", a brand name), so it is shown but never counted as a
 *  problem. */
export const isProblem = (check: Check) => check !== 'unchanged'

/** How many keys have a problem in any language. */
export const countProblems = (keys: TextKey[], locales: string[]) =>
  keys.filter((key) => locales.some((locale) => audit(key, locale, locales[0]!).some(isProblem)))
    .length

/** A file's texts by dotted key: nested objects are joined with dots. What is not a text, or not a
 *  valid key, is named in `skipped`. */
export function flatten(strings: Record<string, unknown>, prefix = '') {
  const out: Record<string, string> = {}
  const skipped: string[] = []
  for (const [name, value] of Object.entries(strings)) {
    const key = prefix ? `${prefix}.${name}` : name
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const inner = flatten(value as Record<string, unknown>, key)
      Object.assign(out, inner.strings)
      skipped.push(...inner.skipped)
    } else if (typeof value === 'string' && isKey(key)) out[key] = value
    else skipped.push(key)
  }
  return { strings: out, skipped }
}

/** The sync script's version. linguitas serves the script and names this version in its
 *  manifest, so a site's copy can tell it is old; the script sends its own with a report. */
export const SYNC_VERSION = 1

/** What a site's build reports: who it is, the version it built with, and every key its code
 *  uses. Keys that do not exist are welcome: they are what the code asks for in vain. */
export const reportSchema = z
  .object({
    consumer: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Name the site in lowercase letters, digits and -.'),
    version: z.number().int().min(0),
    sync: z.number().int().min(1),
    keys: z.array(keySchema).max(20_000),
  })
  .strict()
export type Report = z.infer<typeof reportSchema>

/** A site that reported which keys it uses. */
export interface Consumer {
  name: string
  /** The version it built with. */
  version: number
  /** Its sync script's version. */
  sync: number
  reportedAt: number
  /** How many keys it uses that do not exist. */
  missing: number
}

/** "1 key that does not exist", "3 keys that do not exist". */
export const missingKeys = (count: number) =>
  `${count === 1 ? '1 key that does' : `${formatCount(count)} keys that do`} not exist`

/** What was published: each language's texts by key. Sites read one language of it. */
export type Snapshot = Record<string, Record<string, string>>

/** A project's translations, as its admin page shows them. */
export interface TranslationSpace {
  token: string
  source: string
  /** Every language worked in, the source first. */
  locales: string[]
  /** The ones the next publish delivers; the rest are drafts. */
  live: string[]
  /** The ones sites get now, from the last publish. */
  delivered: string[]
  keys: TextKey[]
  /** The last publish, if any. */
  version: number
  publishedAt: number | null
  /** Whether the texts differ from what was last published. */
  unpublished: boolean
  /** Every version published, newest first. */
  versions: { version: number; publishedAt: number }[]
  /** The sites that reported which keys they use. */
  consumers: Consumer[]
  /** By key, the consumers that use it; a key no consumer uses is not here. Keys that do not
   *  exist are here too: the code asks for them. */
  usage: Record<string, string[]>
}
