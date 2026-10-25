# linguitas

Texts per language for your sites: write them, see what is missing or stale, publish them as JSON.

**linguitas is a module for [nexitas](https://github.com/sovrin/nexitas), not an app of its own.**
It ships inside nexitas, which builds it in from its `modules.json`, and an install's owner switches
it on as Translations. nexitas brings the sign-in, the page shell, the database and the projects;
linguitas adds:

- **translations per project**: its languages (the source first), its keys with a text in each, what
  was published (every version), and a build token for the sites' builds;
- the admin pages under Translations: every key in every language with what the audit finds, a
  key's texts, the languages, import and export, and publishing; translations start there, and its Setup
  holds the snippets, assistant access and the build token;
- the delivery API, read by sites, apps and build steps.

## How it fits together

```
site or build ── GET /v1/translations/<project>           → its languages and the published version
               ── GET /v1/translations/<project>/<locale>  → that language's texts by key
owner         ── /p/<project>/translations                 keys × languages, the audit, publish, API
               ── /p/<project>/translations/<key>           one key's texts
```

- **Keys** are what sites look a text up by: words joined by dots, like `checkout.pay.button`. They
  never change once made. A key may carry a note on where its text appears.
- **Languages** are tags (`en`, `de`, `pt-BR`). One is the source; every other one is translated
  from it. A new language is a draft: written and checked here, delivered only once it is live. A
  live one has to be taken offline before it can be removed, and a removed one's texts are kept
  until it is added again. The source is always live, and changes only on its own.
- **Publishing** freezes the texts as they are. Sites get that version until the next publish, so
  work in progress never reaches them.

### The audit

| Check               | Means                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Missing             | The key has no text in this language                                  |
| Source changed      | The source text changed after this translation was written            |
| Placeholders differ | `{name}` or `{{name}}` in the source and the translation do not match |
| Same as source      | The translation is the source text; often fine ("OK"), never counted  |

A translation remembers the source text it was written for. When the source changes, it is stale
until it is changed, or confirmed on its key's page ("Still fits the source").

## Sites: sync and the client

A site uses linguitas through two files linguitas serves, so nothing is published to npm:

- **sync** (`/v1/translations/sync.mjs`), copied into the site once, runs before every build.
- **the client** (`client.js` with its types), which sync writes into the site with the texts.

```sh
curl -o scripts/linguitas.mjs https://nexitas.example.com/v1/translations/sync.mjs
LINGUITAS_URL=https://nexitas.example.com LINGUITAS_PROJECT=<project> \
LINGUITAS_TOKEN=<build token> node scripts/linguitas.mjs --consumer web
```

```ts
import texts from './linguitas/texts.json'
import { start, t, watch } from './linguitas/client'

start(texts, { locale: 'de' })
watch({ url: 'https://nexitas.example.com/v1/translations/<project>' })
t('checkout.pay') // "Bezahlen"
t('export.done', { minutes: 3 }) // placeholders, typed by keys.d.ts
```

**The rule:** every `t()` takes a literal key, `t('nav.home')`, never one put together
(``t(`nav.${item}`)``). A choice between keys is an `if`/`else` with one literal per branch. That
way the build knows every key a site uses.

**What sync does**, in order:

1. **Scans** `--src` (default `app`) with the Vue compiler and the Babel parser the site already
   has: scripts, Vue files and their templates. Only the `t` a file imports from `--from` counts
   (default `linguitas/client`; a site's own wrapper, `--from utils/i18n`).
2. **Fetches** into `--out` (default `app/linguitas`), to be committed:
   - `texts.json`: every published language of the current version;
   - `keys.d.ts`: every key with its placeholders, so a typo or a missing value is a type error;
   - `client.js` and `client.d.ts`.

   When linguitas cannot be reached, it warns and the build goes on with the committed files.
   Without `LINGUITAS_URL` (a fork, a self-hosted build) it fetches nothing and checks the code
   against them, so a site builds without linguitas.

3. **Fails** on a key that is not a literal, a key that does not exist, and a key that exists only
   as a draft ("publish it"). A site never ships asking for a text nobody published.
4. **Reports**, in CI only (`CI` set) and only with the build token and `--consumer`, the keys it
   found; a CI without them builds and says it did not report. The
   Translations page then shows what no site uses ("Not in code") and what a site asks for that
   does not exist, with "Create key".

`--draft` (with the build token, refused in CI) fetches the texts as they are now, so a key works
in development before it is published.

**The client** starts with the build's texts, so `t()` works at once, offline, and if linguitas is
down. `watch` picks up newer published versions while the site runs: in a browser on start and when
the tab is shown again, on a server every minute. A version's files never change and are cached for
good; checking for a new one is a `304` while nothing changed. It keeps nothing in storage and
reports nothing: a build reports, browsers never do.

**Texts are plain text, never HTML.** `t()` returns what was typed in the admin, as it was typed.
Render it as text (`{{ t('…') }}`, `textContent`), never as HTML (`v-html`, `innerHTML`): anyone
who can edit a text could otherwise put markup and script into the site.

## Delivery API

Published texts are open: no token, any origin. They are in every page that shows them anyway.

| Request                                      | Returns                                                       |
| -------------------------------------------- | ------------------------------------------------------------- |
| `GET /v1/translations/:project`              | `{ slug, name, source, locales, version, publishedAt, sync }` |
| `GET /v1/translations/:project/:lg`          | `{ "checkout.pay": "Bezahlen", … }` of the current version    |
| `GET /v1/translations/:project/:v/:lg.json`  | the same of version `v`, cached for good                      |
| `GET /v1/translations/:project/:v/keys.d.ts` | version `v`'s keys, typed for the client                      |

A language's file holds only the keys that have a text in it; the client falls back to the source.
`locales` lists the published languages only. The first two answer with an `ETag`, so asking again
is a `304` while nothing changed. `404` means there is nothing published there. A token sent along
is ignored. While Translations is switched off, every route answers `404`.

The build token, sent as `Authorization: Bearer`, is for builds only:

| Request                                 | Does                                                             |
| --------------------------------------- | ---------------------------------------------------------------- |
| `GET /v1/translations/:project/draft`   | `{ version, source, texts }`, every language as it is now        |
| `GET …/:project/draft/keys.d.ts`        | the draft's keys, typed                                          |
| `POST /v1/translations/:project/report` | `{ consumer, version, sync, keys }`: the keys a site's code uses |

A project takes 60 reports an hour (then `429`) and keeps 50 consumers: a report from a new one
beyond that is a `409` until one is forgotten under Sites.

## Import and export

**Export** writes one JSON file, a _linguitas file_: each key with its note and its texts in the
languages picked.

```json
{
  "linguitas": 1,
  "source": "en",
  "keys": {
    "help.title": {
      "note": "Dialog heading",
      "texts": { "en": "How it works", "de": "So funktioniert’s" }
    }
  }
}
```

Every language and key make a full backup. Some languages, the keys under a prefix (`help.`) or
only what needs work in one language (missing, stale, other placeholders) make the file to hand a
translator.

**Import** reads such files back, and any other JSON as one language's texts by key, flat or
nested, as i18n libraries keep them (its name says which language: `de.json`). Nothing is written
at once: a preview lists every change (a new key, a text or note where there was none, one that
replaces what is there, with both side by side) and leaves out what is the same already and
languages the project lacks. "Fill only what is empty" or "Also replace what differs", and
whether keys the project lacks are made, decide which rows start picked; each can be changed, and
only the picked ones are written, together. An export imported into another install brings the
project's keys, notes and texts as they were.

## Assistants (MCP)

An assistant such as Claude Code can write and translate a project's texts over the
[Model Context Protocol](https://modelcontextprotocol.io). It is off until the owner turns it on
under Setup on the Translations page, which gives a token of its own (`ltm_…`): the build token sits
in CI and never writes. Turning it off, or on again, makes the old token stop working at once.

```sh
claude mcp add --transport http linguitas https://nexitas.example.com/v1/translations/<project>/mcp \
  --header "Authorization: Bearer <MCP token>"
```

| Tool           | Does                                                                                 |
| -------------- | ------------------------------------------------------------------------------------ |
| `list_keys`    | The languages, and every key with its note and source text; with `locale`, its audit |
| `get_key`      | One key in every language                                                            |
| `save_keys`    | Create keys or change their note and texts, up to 200 at a time; returns the audit   |
| `translate`    | What translating keys into a language takes: source, note, placeholders, a glossary  |
| `add_language` | Add a draft language                                                                 |

**The assistant translates, not linguitas.** `translate` gives it each key's source text, its
note (where the text appears, so it decides the wording and the length), the placeholders to keep,
the current translation and the source it was written for, and up to 40 of the project's settled
translations to stay consistent with. Without `keys`, it picks what is missing, stale or has wrong
placeholders. The assistant then saves what it wrote with `save_keys`, which answers with what the
audit still finds. No text leaves nexitas for an AI service of nexitas' own, and nothing reaches a
site until the owner publishes.

The endpoint answers every call at once (Streamable HTTP without sessions or a stream), only with
the token, and never to a page: a request with an `Origin` is refused.

## Admin API

The admin pages use it, under the owner's session; writes come from nexitas' own origin, like every
`/api` route. All paths start with `/api/p/:project/translations`.

| Request                                   | Does                                                                |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `GET · POST /`                            | Languages, keys and texts, `404` before it starts · start           |
| `POST /languages`                         | Add a draft language `{ locale }`                                   |
| `POST /languages/:locale`                 | Put it live or take it offline `{ live }`                           |
| `POST …/:locale/source` · `…/delete`      | Make a live one the source · remove a draft                         |
| `POST /import/preview`                    | What files would change `{ files: [{ name, locale?, content }] }`   |
| `POST /import`                            | Write picked changes `{ entries: [{ key, locale \| null, text }] }` |
| `GET /export?locales=&prefix=&needs=`     | A linguitas file to download                                        |
| `POST /publish` · `POST /token`           | Publish the texts as they are · replace the build token             |
| `POST /mcp`                               | Assistant access `{ on }`: a new MCP token, or none                 |
| `POST /versions/:version/publish`         | Publish an earlier version again, as the next one                   |
| `POST /consumers/:consumer/delete`        | Forget a site, so its keys stop counting as used                    |
| `POST /keys`                              | Add one `{ key, note, texts: { [locale]: text } }`                  |
| `GET · POST /keys/:key` · `POST …/delete` | Read · replace `{ note, texts, confirmed: [locale] }` · delete      |

An empty text removes it. Deleting a project in nexitas deletes its translations with it.

## Develop

linguitas has no app, build or image of its own: it runs inside nexitas. Check out nexitas, aequitas
and linguitas next to each other, build aequitas once (`cd ../aequitas && pnpm install && pnpm
build`), and put this checkout into nexitas' modules:

```sh
pnpm install
ln -s ../../linguitas ../nexitas/.modules/linguitas
cd ../nexitas && node scripts/modules.ts && pnpm install && pnpm dev
```

Switch Translations on, at setup or under Modules. The typecheck of the pages and server runs in
nexitas (`pnpm check` there); here `pnpm check` runs the unit tests.

## Not here yet

Linking to veritas (a field that is a key), plurals beyond what the text itself holds, export to
PO or XLIFF, machine translation, users and roles. Live updates pushed to sites' servers (they
check instead), a deploy hook for static sites, and delivery that needs a token for confidential
texts.

## Checks

```sh
pnpm check         # the unit tests
pnpm lint
pnpm format:check
node ../aequitas/dist/aequitas-check.mjs --css ../nexitas/app/assets/nexitas.css app/**/*.vue
```
