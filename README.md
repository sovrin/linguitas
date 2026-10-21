# linguitas

Texts per language for your sites: write them, see what is missing or stale, publish them as JSON.

**linguitas is a module for [nexitas](https://github.com/sovrin/nexitas), not an app of its own.**
It ships inside nexitas, which builds it in from its `modules.json`, and an install's owner switches
it on as Translations. nexitas brings the sign-in, the page shell, the database and the projects;
linguitas adds:

- **translations per project**: its languages (the source first), its keys with a text in each, what
  was last published, and a read token for its sites;
- the admin pages under Translations: every key in every language with what the audit finds, a
  key's texts, the languages, an import and publishing;
- a Translations panel on each project's page: start them, see what is left to check;
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

## Delivery API

Read-only. Only what was published. Every request needs the project's token, which its Translations
page shows (and can replace). Any origin may call it.

```bash
curl -H "Authorization: Bearer $TOKEN" https://nexitas.example.com/v1/translations/<project>/de
```

| Request                             | Returns                                                         |
| ----------------------------------- | --------------------------------------------------------------- |
| `GET /v1/translations/:project`     | `{ slug, name, source, locales, version, publishedAt }`         |
| `GET /v1/translations/:project/:lg` | `{ "checkout.pay": "Bezahlen", … }`, flat, keys sorted, no gaps |

A language's file holds only the keys that have a text in it; fall back to the source in your i18n
library. `locales` lists the published languages only. `401` means the token is wrong or the
project has no translations. `404` means the language was not published. While Translations is
switched off, every route answers `404`.

## Admin API

The admin pages use it, under the owner's session; writes come from nexitas' own origin, like every
`/api` route. All paths start with `/api/p/:project/translations`.

| Request                                   | Does                                                           |
| ----------------------------------------- | -------------------------------------------------------------- |
| `GET · POST /`                            | Languages, keys and texts, `404` before it starts · start      |
| `POST /languages`                         | Add a draft language `{ locale }`                              |
| `POST /languages/:locale`                 | Put it live or take it offline `{ live }`                      |
| `POST …/:locale/source` · `…/delete`      | Make a live one the source · remove a draft                    |
| `POST /import`                            | One language file `{ locale, strings }`, flat or nested        |
| `POST /publish` · `POST /token`           | Publish the texts as they are · replace the token              |
| `POST /keys`                              | Add one `{ key, note, texts: { [locale]: text } }`             |
| `GET · POST /keys/:key` · `POST …/delete` | Read · replace `{ note, texts, confirmed: [locale] }` · delete |

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
PO or XLIFF, machine translation, older versions of a publish, users and roles.

## Checks

```sh
pnpm check         # the unit tests
pnpm lint
pnpm format:check
node ../aequitas/dist/aequitas-check.mjs --css ../nexitas/app/assets/nexitas.css app/**/*.vue
```
