# Plan: sync, live texts and usage

Sites use linguitas through a build step (**sync**) and a small runtime (**client**). The build
knows exactly which keys a site uses, fails on what is missing, and ships the texts as a floor;
the browser only reads, and picks up newer published texts without a rebuild.

## Decisions

- Every `t()` takes a string literal. A key is never assembled; a choice between keys is an
  `if`/`else` or `switch` with one literal per branch. Sync fails on anything else.
- Published texts are public: reading them needs no token. The project's token becomes the
  **build token**, a secret for CI and developers only. It reports usage and reads drafts.
- Drafts are available locally (`--draft`), never in CI.
- A missing key fails the build: one that does not exist, and in CI one that is only a draft.
- Sync reports usage only from CI, so a branch on a laptop never rewrites what a site uses.
- No visitor is ever reported on. No npm package: linguitas serves the client and the sync
  script itself, like collatas' `/v1/form.js` and erratas' `/v1/errors.js`.
- Not decided: how sonotas renders a language (a route per language, or on the client).

## How it works

```
linguitas ── publish ──▶ version N, immutable per language
    ▲                         │
    │ report (build token)    │ texts, types, client (open; drafts with the build token)
    │                         ▼
site build ── node scripts/linguitas.mjs ── scan · check · fetch ──▶ nuxt generate
                                                                        │
browser ── t() from the build's texts ── checks the manifest ──▶ newer version, swapped in
```

## Phase 1 — Delivery

Reading published texts gets cheap, cacheable and open.

- **Migration step** (appended to `linguitas.migrations`, never editing the released one):
  - `translation_versions (project_id, version, texts JSON, published_at)`, primary key
    `(project_id, version)`.
  - Backfill the current `published` blob as its version.
  - `publish()` writes a row per version. `published` stays as the current version's copy.
- **Routes:**
  - `GET /v1/translations/<project>` — the manifest: version, languages, source.
    - Held in memory per project (one process, as `server/utils/changes.ts` assumes) and rebuilt
      on publish.
    - Sent with an `ETag` and `Cache-Control: no-cache`, so an unchanged manifest is a `304`
      without touching SQLite.
  - `GET /v1/translations/<project>/<version>/<locale>.json` — one language of one version.
    - `Cache-Control: public, max-age=31536000, immutable`.
  - `GET /v1/translations/<project>/<locale>` stays, as the current version, for existing
    callers.
- **No token on reads:**
  - The guard stays `readOnlyCors`, and `requireTranslationToken` leaves the read routes.
  - A token that is sent anyway is ignored, so existing callers keep working.
  - Widen the `publicRoutes` pattern to cover the new paths.
- **Republish:** "Publish version 4 again" publishes that version's texts as N+1, so history
  stays linear. It's offered in a publish history on the Translations page.
- **Tests:** `publish` writes versions; republish copies; the manifest's ETag changes only on
  publish; a 304 on a matching `If-None-Match`.

## Phase 2 — Build token, drafts, reports

- **Rename** the token to "build token" in the Delivery aside and the README. The column stays
  `token`; the meaning changes, not the schema.
- **Drafts:** `GET /v1/translations/<project>/draft` with the build token as bearer
  (`requireBearer`).
  - Returns every key, the texts of the live languages as they are now, and the source.
  - Never cached.
- **Report:** `POST /v1/translations/<project>/report` with the build token, sent by sync.
  - Body: `{ consumer, version, sync, keys: string[] }`.
    - `consumer`: a name like `sonotas`, the key's shape.
    - `version`: the version the site builds with.
    - `sync`: the script's version.
    - `keys`: capped, each validated against the key shape.
  - Server to server, so no browser origin. Check what `server/middleware/security.ts` asks of
    a public `POST`; the guard is the bearer, not CORS.
- **Migration step:**
  - `translation_consumers (project_id, consumer, version, sync, reported_at)`.
  - `translation_usage (project_id, consumer, key)`.
  - A report replaces that consumer's usage rows in one `transaction`.
  - Missing keys are not stored: they are the usage rows whose key does not exist.
- **Types:** `GET /v1/translations/<project>/<version|draft>/keys.d.ts`.
  - Generated from the source texts: one overload per key, with its placeholders (`{name}`,
    `{{name}}`, from the parser the audit already uses) as the parameter object.
  - Generated on the server, so sync stays thin and old copies of it keep working.
- **Tests:**
  - A report replaces rows.
  - The caps and the key shape are enforced.
  - The generated overloads for no, one and two placeholders.
  - Drafts are refused without the token.

## Phase 3 — Client and sync

Both live in linguitas under `client/`. A build hook bundles them with esbuild into
`public/v1/translations/`, as collatas does for its form. A file name with a dot never collides
with a project id.

- **`client.js`**, plus its `.d.ts`. No dependencies, no framework.
  - `createTranslations({ texts, locale })` → `t(key, params?)`:
    - Looks in the language, then the source language.
    - Fills placeholders.
    - Synchronous.
  - `setLocale(locale)` and `subscribe(callback)`, so a site can make the texts reactive (a
    `shallowRef` in Vue).
  - `watch({ url, project })`:
    - Checks the manifest with `If-None-Match` on start and when the tab becomes visible again.
    - On a newer version, loads `<version>/<locale>.json` and the source language, swaps them,
      and calls the subscribers.
    - Uses no storage of its own; the HTTP cache keeps the versioned files.
    - On a server: the same check on an interval.
- **`sync.mjs`**, copied into a site once as `scripts/linguitas.mjs`.
  - Options from the environment or flags: `LINGUITAS_URL`, `LINGUITAS_PROJECT`,
    `LINGUITAS_TOKEN`, `--consumer`, `--src` (default `app`), `--out` (default `app/linguitas`),
    `--from` (the module `t` is imported from, default the client), `--draft`.
  - **1. Scan** `.ts`, `.js` and `.vue` under `--src` as syntax trees, not text.
    - **Parsers:** Vue's compiler (`vue/compiler-sfc`) and the Babel parser it depends on,
      both resolved from the site's own `node_modules`. Nothing is installed for sync.
      - In a Nuxt site, pnpm keeps `vue` reachable only through `nuxt`, so the lookup tries
        `vue/compiler-sfc` from the site first, then from `nuxt/package.json`.
    - **What gets parsed:** in a `.vue` file, its `<script>` blocks (with TypeScript), and every
      expression its template keeps: interpolations, bound attributes, `v-if`, event handlers.
    - **Which `t` counts:** only the `t` a file imports from the client or from the site's own
      wrapper (`--from '~/utils/i18n'`). A template's `t` is its `<script setup>` import.
      - So `t` must be imported explicitly, not auto-imported.
      - A function parameter called `t` hides the import inside that function.
    - **Literals:** a string literal, or a template literal without `${`, is a use, recorded
      with its file and line.
    - **Violations:** any other argument (a variable, a call, `${…}`) is one, with its file and
      line.
    - **Proved on sonotas' own dependencies:**
      - Found: `script setup` calls, `:title="t('…')"`, `{{ t('…', { n }) }}`, both branches of
        a ternary.
      - Reported as violations: a `${…}` template and an identifier argument.
      - Skipped: a shadowing parameter.
      - Every line number was right.
  - **2. Fetch** the manifest and texts (or the draft with `--draft`) and `keys.d.ts`, plus the
    current `client.js` and its types. Write them into `--out`.
    - The site commits them. When linguitas cannot be reached, sync warns and keeps the
      committed files, so linguitas being down never blocks a deploy.
  - **3. Check**, and exit 1 if anything fails:
    - Literal-only violations.
    - Keys that do not exist.
    - Without `--draft`: keys that exist only as a draft ("publish it in linguitas").
  - **4. Report**, only when `CI` is set.
  - `--draft` with `CI` set is refused.
  - Warns when a newer sync script is available (the manifest names the current one).
- **Tests:**
  - The scan: literals, templates with and without `${`, Vue templates and directives, a
    shadowing parameter, a `t` not imported from the client, violations with their lines.
  - The checks' exit codes.
  - The client: fallback, placeholders, swapping on a newer version.

## Phase 4 — The Translations page

- **Audit:**
  - **Not in code**, as a per-key choice in the filter row, shown once a consumer has
    reported. A key is unused when every consumer that reported leaves it out.
  - The key inspector names the consumers that use the key.
- **Asked for, not there:** a section listing keys consumers use that do not exist. Each has
  "Create key", which opens `_new` with the key filled in.
- **Delivery aside:**
  - The build token.
  - **Consumers:** each with its last report, the version it built with, and its sync script
    (marked when old).
  - Publish history with "Publish again".
  - Setup: the sync command and the client lines, in `<EmbedCode>`.
- **Overview:**
  - `projectStatus`: the count of missing keys as a warning.
  - `projectActivity`: "sonotas asks for 2 keys that don't exist" and "Version 6 published".
- **README:** the delivery section rewritten (open reads, versioned files, build token, sync,
  the literal-key rule).

## Phase 5 — sonotas, the first consumer

Every module runs on one instance, `https://nexitas.sovrin.de`: sync gets
`LINGUITAS_URL=https://nexitas.sovrin.de`, the client watches
`https://nexitas.sovrin.de/v1/translations/sonotas`, and the tracker and the feedback form load from
there too.

- Add `scripts/linguitas.mjs`.
- Run it in the Dockerfile before `pnpm generate`, with `LINGUITAS_TOKEN` as a build secret and
  `CI=1`.
- `app/utils/i18n.ts`, as `track.ts` does:
  - The client with the build's texts, made reactive with a `shallowRef`.
  - `watch()` started after hydration, never in dev.
- Replace the components' strings with `t('…')`.
- Allow sonotas' origin on its linguitas project. The README's privacy line stays true: the
  browser reads, it reports nothing.
- Waits on the open decision: a route per language, or rendering on the client. Until it's
  decided, sonotas runs in English through the same path.

## Later, when a site needs it

- SSE for sites with their own servers (one connection per process).
- A deploy hook per project, called on publish, for static sites that want a rebuild.
- "Delivery needs the token", per project, for internal apps whose texts are confidential.
- How often visitors see a fallback, as a sampled report, to decide what to translate first.

## Releases

- Phases 1–4 are additive for existing callers: reads keep working, with or without a token.
  Commit them as `feat(delivery): …`, `feat(sync): …` and so on, never with an empty scope.
- linguitas changes nothing in `shared/modules.ts`, so nexitas is untouched.
- **Breaking:** if a later version ever removes the unversioned `/<locale>` route, mark it
  with `!`.
