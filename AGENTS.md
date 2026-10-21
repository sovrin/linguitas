# Agent notes for linguitas

Conventions for working on linguitas, in code and in the interface.

## Code

- linguitas is a module of [nexitas](https://github.com/sovrin/nexitas): a plain Nuxt layer that
  nexitas extends. The owner's sign-in, the `/api` guard, live updates, the database, projects and
  the page shell are there, and plug-in points are its interfaces (`shared/modules.ts`). linguitas
  registers itself in `server/core/module.ts`. What every module needs belongs in nexitas; what only
  linguitas needs, here.
- A project's translations belong to one nexitas project: its delivery token, its languages (one the
  source, each live or a draft), its keys with their texts, and what was last published. Its panel on a project's
  page is `app/components/global/LinguitasProject.vue`.
- Import by relative path (or `#nexitas/...`): `~` and `#shared` resolve against nexitas, the app
  around this layer. Nothing app-wide lives here: no name, logo, favicon or sign-in lines.
- Keep comprehension debt low: explicit control flow, small modules, framework conventions, no
  speculative abstractions. Comments say why, not what.
- Every rule about input lives once, in `shared/contracts.ts` (zod), and is checked at runtime on
  the server. So does the audit (`audit()`: missing, stale, placeholders, same as source), which the
  admin runs on what it shows and the status line on what is stored.
- A translation keeps the source text it was written for (`based_on`); it is stale when the source
  differs. Only changing it or confirming it moves that on, so saving a key never clears a stale
  translation by accident.
- Data access is plain SQL in `server/core/*.ts`: functions that take the database first, no ORM.
  Schema changes are a new step in `migrations` in `server/core/module.ts`; never edit a released
  step.
- Keys are addresses: once saved they never change.
- No language change reaches sites in one step: a new language is a draft until put live, a live
  one goes offline before it can be removed, and every change waits for the next publish. A
  removed language keeps its texts. The server enforces this, not only the Languages page.
- `/api/p/<project>/translations/*` is the owner's (nexitas' security middleware), and its handlers
  take the project from `requestProject(event)`. The delivery API, `/v1/translations/*`,
  is public through `publicRoutes` in `server/core/module.ts`: read-only, only what was published,
  any origin, a project's bearer token. Sites and builds out there read it, so it only grows (nothing
  renamed or removed).
- The admin is live: whatever changes what it shows calls `announceChange()`, and every view that
  shows data passes its refresh to `useLive`.

## UI

- Built only from aequitas: semantic HTML plus its classes, `data-*` variants and ARIA state.
- The look: nexitas' shell (navbar, one small column, statusbar); inside a page, compact density,
  square corners, no cards, panels or sidebar. Colour only reports state, always next to a word.
  Keys, language tags and API paths are mono. Text actions first, at most one primary button per view.
- Lint changed Vue files: `node ../aequitas/dist/aequitas-check.mjs --css ../nexitas/app/assets/nexitas.css <files>`.

## Checks

`pnpm check`, `pnpm lint` and `pnpm format:check` must stay green here, and `pnpm check` and
`pnpm build` in nexitas with this checkout in its `.modules/`.

## Commits and releases

Commit messages are [conventional](https://www.conventionalcommits.org):
`feat(keys): …`, `fix: …`, `docs(readme): …`. Give a scope or leave the parentheses out; never
write `feat(): …`. release-please can't parse an empty scope and silently drops the commit from
the next version and the changelog. Before 1.0, `feat` and `fix` bump the patch version and a
change marked `!` the minor. Mark a change that breaks the public `/v1` API with `!`
(`feat(api)!: …`), since sites and builds out there depend on it. Don't edit the version in
`package.json` or `CHANGELOG.md` by hand; the release PR does that.
