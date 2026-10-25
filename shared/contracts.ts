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
/** Whether assistants may edit the texts over MCP: on gives a new token, off drops it. */
export const mcpAccessSchema = z.object({ on: z.boolean() }).strict()
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

/** A linguitas file: every key with its note and its texts by language. The export writes it and
 *  the import reads it back, so a project moves between installs, or to a translator and back,
 *  whole. Keys are flat. */
export interface TransferFile {
  linguitas: 1
  source: string
  keys: Record<string, { note?: string; texts: Record<string, string> }>
}

/** What an import may change: a key's text in one language, or its note (`locale` null). */
export interface ImportEntry {
  key: string
  locale: string | null
  text: string
}

/** Files to read for an import: linguitas files, or one language's texts each, flat or nested as
 *  i18n libraries keep them, in the language `locale` names. */
export const importFilesSchema = z
  .object({
    files: z
      .array(
        z
          .object({
            name: z.string().max(200),
            locale: localeSchema.optional(),
            content: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()

/** The entries the owner picked from a preview, to write. */
export const importApplySchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            key: keySchema,
            locale: localeSchema.nullable(),
            text: z.string().max(10_000),
          })
          .strict(),
      )
      .min(1)
      .max(20_000),
  })
  .strict()

/** One change a preview offers: `key` makes the key, `new` fills what is empty, `changed`
 *  replaces what is there (`before`). */
export interface ImportRow extends ImportEntry {
  change: 'key' | 'new' | 'changed'
  before: string | null
  file: string
}

export interface ImportPreview {
  rows: ImportRow[]
  /** How many entries say what the project says already. */
  same: number
  /** Languages a file has texts in that the project lacks; their texts are left out. */
  unknownLocales: string[]
  /** What could not be read, as `file: key`. */
  skipped: string[]
}

/** The entries of one uploaded file. A linguitas file brings its own languages and notes; any
 *  other is one language's texts, in `locale`. An empty text is skipped: it would remove one. */
export function readImportFile(content: Record<string, unknown>, locale: string | undefined) {
  const entries: ImportEntry[] = []
  const skipped: string[] = []
  if (content.linguitas === 1 && content.keys && typeof content.keys === 'object') {
    for (const [key, value] of Object.entries(content.keys as Record<string, unknown>)) {
      const item = value as { note?: unknown; texts?: unknown } | null
      if (!isKey(key) || !item || typeof item !== 'object') {
        skipped.push(key)
        continue
      }
      if (typeof item.note === 'string' && item.note.length <= 500)
        entries.push({ key, locale: null, text: item.note.trim() })
      for (const [at, text] of Object.entries((item.texts ?? {}) as Record<string, unknown>)) {
        if (LOCALE.test(at) && typeof text === 'string' && text && text.length <= 10_000)
          entries.push({ key, locale: at, text })
        else skipped.push(`${key} (${at})`)
      }
    }
    return { entries, skipped }
  }
  if (!locale) return { entries, skipped: ['the whole file: name its language'] }
  const flat = flatten(content)
  for (const [key, text] of Object.entries(flat.strings))
    if (text) entries.push({ key, locale, text })
    else skipped.push(key)
  return { entries, skipped: [...skipped, ...flat.skipped] }
}

/** The language a plain file's name names: de.json, messages.pt-BR.json. */
export function localeOfFileName(name: string) {
  const tag =
    name
      .replace(/\.json$/i, '')
      .split(/[._/\\]/)
      .pop() ?? ''
  return LOCALE.test(tag) ? tag : undefined
}

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

/** How deep a file's objects may nest. */
const MAX_DEPTH = 20

/** A file's texts by dotted key: nested objects are joined with dots. What is not a text, not a
 *  valid key, or nested deeper than MAX_DEPTH, is named in `skipped`. */
export function flatten(strings: Record<string, unknown>, prefix = '', depth = 0) {
  const out: Record<string, string> = {}
  const skipped: string[] = []
  for (const [name, value] of Object.entries(strings)) {
    const key = prefix ? `${prefix}.${name}` : name
    if (value && typeof value === 'object' && !Array.isArray(value) && depth < MAX_DEPTH) {
      const inner = flatten(value as Record<string, unknown>, key, depth + 1)
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
  /** What an assistant edits the texts with over MCP; null while that is off. */
  mcpToken: string | null
  source: string
  /** Every language worked in, the source first. */
  locales: string[]
  /** The ones the next publish delivers; the rest are drafts. */
  live: string[]
  /** The ones sites get now, from the last publish. */
  delivered: string[]
  /** How many keys there are; the tree's rows come one level at a time (`/translations/tree`). */
  keyCount: number
  /** By language, how many keys have a text in it. */
  filled: Record<string, number>
  /** By audit check, how many keys have it in any language. */
  checks: Record<Check, number>
  /** How many keys have a problem in a live language (countProblems). */
  problems: number
  /** How many keys no site's code uses. */
  unused: number
  /** Keys a site's code uses that do not exist, with the sites asking: their builds fail. */
  asked: { key: string; consumers: string[] }[]
  /** The last publish, if any. */
  version: number
  publishedAt: number | null
  /** Whether the texts differ from what was last published. */
  unpublished: boolean
  /** Every version published, newest first. */
  versions: { version: number; publishedAt: number }[]
  /** The sites that reported which keys they use. */
  consumers: Consumer[]
}
