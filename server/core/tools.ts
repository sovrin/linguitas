// What an assistant can do with a project's texts over MCP: read the keys, write keys and texts,
// and get what it needs to translate them well. The assistant translates; linguitas calls no AI.
// Publishing stays the owner's, on the Translations page.
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import {
  audit,
  changesetNameSchema,
  keySchema,
  localeSchema,
  parseText,
  placeholders,
  pluralForms,
  type TextKey,
} from '#self/shared/contracts'
import { tool } from '#nexitas/server/utils/mcp'
import {
  createChangeset,
  getChangeset,
  listChangesets,
  saveChanges,
  withChangeset,
} from './changesets'
import {
  addLocale,
  createKey,
  deleteKey,
  getKey,
  getSpace,
  listKeys,
  updateKey,
} from './translations'

const MAX_KEYS = 200
// Enough for a translation to stay with the words the project already uses.
const GLOSSARY = 40

export const instructions = `linguitas holds this project's texts: keys (such as export.done) with a text per language, and a note on where the text appears.
To port a site's strings: save_keys with the source language's texts and a note each, then translate for every other language and save_keys with what you wrote.
Keep every {placeholder} exactly. A text that depends on a number is one ICU plural, never two keys: {count, plural, one {# bar} other {# bars}}; # is the number, and each language writes the forms it needs (translate names them).
For a feature still in development, start a changeset (create_changeset, named like its branch) and pass it as \`changeset\` to every tool: changes wait there, apart from the draft, until the owner applies them as the feature goes live. A developer's build sees them with sync --changeset <name>.
Nothing reaches a site until the owner publishes on the Translations page.`

/** The project's tools, each bound to it. `changed` runs after a write, to tell open pages. */
export function translationTools(db: DatabaseSync, projectId: string, changed = () => {}) {
  const space = () => getSpace(db, projectId)!
  const checks = (key: TextKey, locales: string[]) =>
    Object.fromEntries(
      locales
        .map((locale) => [locale, audit(key, locale, space().source)] as const)
        .filter(([, found]) => found.length),
    )
  const known = (locale: string) => {
    if (!space().locales.includes(locale))
      throw new Error(`The project has no language ${locale}. add_language adds it.`)
  }
  const changeset = (name: string) => {
    const found = getChangeset(db, projectId, name)
    if (!found) throw new Error(`There is no changeset ${name}. create_changeset starts it.`)
    return found
  }
  // What `run` reads with the changeset laid over the draft, when one is named.
  const within = <T>(name: string | undefined, run: () => T) =>
    name ? withChangeset(db, projectId, space(), changeset(name), run) : run()
  const inChangeset = changesetNameSchema
    .optional()
    .describe('Work in this changeset: read the draft with it laid over, write into it')

  return [
    tool({
      name: 'list_keys',
      description:
        "The project's languages and its keys with their note and source text. With `locale`, also that language's text and what the audit finds in it (missing, stale, placeholders, unchanged).",
      input: z.object({
        prefix: z
          .string()
          .max(120)
          .optional()
          .describe('Only keys starting with this, e.g. "help."'),
        locale: localeSchema.optional(),
        changeset: inChangeset,
      }),
      run: ({ prefix, locale, changeset: name }) => {
        if (locale) known(locale)
        const { source, locales, live } = space()
        const keys = within(name, () => listKeys(db, projectId)).filter(
          (key) => !prefix || key.key.startsWith(prefix),
        )
        return {
          source,
          languages: locales.map((code) => ({ locale: code, live: live.includes(code) })),
          keys: keys.map((key) => ({
            key: key.key,
            note: key.note || undefined,
            text: key.texts[source]?.text,
            ...(locale && locale !== source
              ? { [locale]: key.texts[locale]?.text, checks: audit(key, locale, source) }
              : {}),
          })),
        }
      },
    }),
    tool({
      name: 'get_key',
      description: 'One key: its note, its text in every language, and what the audit finds.',
      input: z.object({ key: keySchema, changeset: inChangeset }),
      run: ({ key, changeset: name }) => {
        const found = within(name, () => getKey(db, projectId, key))
        if (!found) throw new Error(`There is no key ${key}.`)
        return {
          key: found.key,
          note: found.note,
          texts: Object.fromEntries(
            Object.entries(found.texts).map(([at, text]) => [at, text.text]),
          ),
          checks: checks(found, space().locales),
        }
      },
    }),
    tool({
      name: 'save_keys',
      description: `Creates keys and changes their note and texts, up to ${MAX_KEYS} at a time. A key that exists keeps the languages and the note you leave out; an empty text removes that language's. Returns what the audit then finds, to fix right away.`,
      input: z.object({
        keys: z
          .array(
            z.object({
              key: keySchema,
              note: z
                .string()
                .trim()
                .max(500)
                .optional()
                .describe('Where the text appears and anything a translator must know'),
              texts: z.record(localeSchema, z.string().max(10_000)).default({}),
            }),
          )
          .min(1)
          .max(MAX_KEYS),
        changeset: inChangeset,
      }),
      run: ({ keys, changeset: name }) => {
        const { locales } = space()
        for (const { texts } of keys) for (const locale of Object.keys(texts)) known(locale)
        if (name) {
          // A key the draft has is updated, any other added; the changeset merges them in.
          const changes = keys.map(({ key, note, texts }) =>
            getKey(db, projectId, key)
              ? { op: 'update' as const, key, note, texts, confirmed: [] }
              : { op: 'add' as const, key, note, texts },
          )
          saveChanges(db, projectId, space(), changeset(name).name, changes)
          changed()
          return within(name, () =>
            keys.map(({ key }) => ({ key, checks: checks(getKey(db, projectId, key)!, locales) })),
          )
        }
        const saved = keys.map(({ key, note, texts }) => {
          const before = getKey(db, projectId, key)
          const input = { note: note ?? before?.note ?? '', texts, confirmed: [] }
          if (before) updateKey(db, projectId, locales, key, input)
          else createKey(db, projectId, locales, key, input)
          return {
            key,
            saved: before ? 'updated' : 'created',
            checks: checks(getKey(db, projectId, key)!, locales),
          }
        })
        changed()
        return saved
      },
    }),
    tool({
      name: 'translate',
      description:
        "What you need to translate keys into a language: each key's source text, its note (where the text appears; let it decide the wording and length), the placeholders to keep, the plural forms the language needs (write an ICU plural with exactly those, # for the number), the current translation if any, and a glossary of the project's existing translations to stay consistent with. Without `keys`, every key that is missing, stale, or wrong in its placeholders or plural forms in that language. Translate, then save_keys with texts: { [locale]: … }.",
      input: z.object({
        locale: localeSchema,
        keys: z.array(keySchema).max(MAX_KEYS).optional(),
        prefix: z.string().max(120).optional(),
        changeset: inChangeset,
      }),
      run: ({ locale, keys: asked, prefix, changeset: name }) => {
        known(locale)
        const { source } = space()
        if (locale === source)
          throw new Error(`${locale} is the source language: write it, then translate from it.`)
        const all = within(name, () => listKeys(db, projectId))
        const wanted = all.filter((key) =>
          asked
            ? asked.includes(key.key)
            : (!prefix || key.key.startsWith(prefix)) &&
              audit(key, locale, source).some((check) => check !== 'unchanged'),
        )
        const unknown = asked?.filter((key) => !all.some((found) => found.key === key)) ?? []
        if (unknown.length) throw new Error(`There is no key ${unknown.join(', ')}.`)
        const todo = wanted.filter((key) => key.texts[source])
        // Short, settled translations: the project's own terms for buttons and labels.
        const glossary = all
          .filter(
            (key) => key.texts[locale] && key.texts[source] && !audit(key, locale, source).length,
          )
          .map((key) => ({ [source]: key.texts[source]!.text, [locale]: key.texts[locale]!.text }))
          .sort((a, b) => a[source]!.length - b[source]!.length)
          .slice(0, GLOSSARY)
        return {
          from: source,
          to: locale,
          keys: todo.slice(0, MAX_KEYS).map((key) => ({
            key: key.key,
            note: key.note || undefined,
            source: key.texts[source]!.text,
            placeholders: placeholders(key.texts[source]!.text),
            // The forms this language's plurals need, when the source has one.
            pluralForms: parseText(key.texts[source]!.text).plurals.length
              ? pluralForms(locale)
              : undefined,
            current: key.texts[locale]?.text,
            // What the source said when the current translation was written.
            writtenFor:
              key.texts[locale]?.basedOn !== key.texts[source]!.text
                ? (key.texts[locale]?.basedOn ?? undefined)
                : undefined,
          })),
          more: Math.max(0, todo.length - MAX_KEYS) || undefined,
          withoutSource: wanted.filter((key) => !key.texts[source]).map((key) => key.key),
          glossary,
        }
      },
    }),
    tool({
      name: 'add_language',
      description:
        'Adds a language as a draft: you can write its texts at once; sites get it only once the owner makes it live and publishes.',
      input: z.object({ locale: localeSchema }),
      run: ({ locale }) => {
        const added = addLocale(db, projectId, locale)
        if (added) changed()
        return { locale, added }
      },
    }),
    tool({
      name: 'delete_keys',
      description: `Deletes keys with their note and their texts in every language, up to ${MAX_KEYS} at a time; a deleted key cannot be brought back. Published versions keep their texts until the owner publishes again. For keys no code uses any more, such as two keys folded into one plural.`,
      input: z.object({ keys: z.array(keySchema).min(1).max(MAX_KEYS), changeset: inChangeset }),
      run: ({ keys, changeset: name }) => {
        if (name) {
          saveChanges(
            db,
            projectId,
            space(),
            changeset(name).name,
            keys.map((key) => ({ op: 'remove' as const, key })),
          )
          changed()
          return { removing: keys, in: name }
        }
        const deleted = keys.filter((key) => deleteKey(db, projectId, key))
        if (deleted.length) changed()
        return { deleted, notFound: keys.filter((key) => !deleted.includes(key)) }
      },
    }),
    tool({
      name: 'create_changeset',
      description:
        "Starts a changeset for a feature's key changes, named like its branch (feat/checkout). Pass it as `changeset` to save_keys, delete_keys, translate, list_keys and get_key; the owner applies it on the Translations page when the feature goes live.",
      input: z.object({
        name: changesetNameSchema,
        note: z.string().trim().max(500).optional().describe('What the feature is'),
      }),
      run: ({ name, note }) => {
        const created = createChangeset(db, projectId, name, note)
        if (created) changed()
        return { name, created }
      },
    }),
    tool({
      name: 'list_changesets',
      description:
        "The project's changesets, open ones first: how many changes each holds and how many wait to be applied. With `name`, that one's changes.",
      input: z.object({ name: changesetNameSchema.optional() }),
      run: ({ name }) => {
        if (!name) return listChangesets(db, projectId)
        const found = changeset(name)
        return {
          name: found.name,
          note: found.note || undefined,
          applied: !!found.appliedAt,
          changes: found.changes.map((change) => ({
            key: change.key,
            op: change.op,
            note: change.note ?? undefined,
            texts: change.op === 'remove' ? undefined : change.texts,
            applied: !!change.appliedAt,
          })),
        }
      },
    }),
  ]
}
