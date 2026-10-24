#!/usr/bin/env node
// linguitas' sync: run by a site's build before it builds, and by a developer.
//
//   curl -o scripts/linguitas.mjs https://<nexitas>/v1/translations/sync.mjs   (once)
//   LINGUITAS_URL=https://<nexitas> LINGUITAS_PROJECT=<project> LINGUITAS_TOKEN=<build token> \
//     node scripts/linguitas.mjs --consumer web
//
// 1. Scans the code for t('…'): every key a literal, so the build knows each key it uses.
// 2. Fetches the published texts (or the draft, --draft), their key types and the client into
//    --out, to be committed: when linguitas cannot be reached, the build goes on with those.
// 3. Fails on a key that is not a literal, one that does not exist, and (without --draft) one
//    that exists only as a draft: a site never ships asking for a text nobody published.
// 4. In CI, reports the keys it found, so linguitas knows what no code uses and what code asks
//    for in vain.
//
// It parses with the Vue compiler and the Babel parser the site already has; nothing is installed.
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { extname, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

export const VERSION = 1

const KEY = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*$/
const SCRIPTS = new Set(['.ts', '.mts', '.js', '.mjs', '.tsx', '.jsx'])
const FUNCTIONS = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
])

// ── Scanning

/** The parsers, from the site in `root`: Vue's SFC compiler and the Babel parser it brings. A
 *  Nuxt site reaches vue only through nuxt when pnpm keeps dependencies strict. */
export async function loadParsers(root) {
  const site = createRequire(join(resolve(root), 'package.json'))
  const attempts = [
    () => site.resolve('vue/compiler-sfc'),
    () => createRequire(site.resolve('nuxt/package.json')).resolve('vue/compiler-sfc'),
  ]
  for (const attempt of attempts) {
    let path
    try {
      path = attempt()
    } catch {
      continue
    }
    const sfc = await import(pathToFileURL(path).href)
    const fromSfc = createRequire(createRequire(path).resolve('@vue/compiler-sfc'))
    const babel = await import(pathToFileURL(fromSfc.resolve('@babel/parser')).href)
    return { sfc, babel }
  }
  try {
    return { sfc: null, babel: await import(pathToFileURL(site.resolve('@babel/parser')).href) }
  } catch {
    throw new Error('sync needs vue or @babel/parser in the site to read its code.')
  }
}

/** Every use of `t` in one file's text: `uses` as { key, line }, `violations` as { line, why }.
 *  Only a `t` the file imports from a module ending in `from` counts; in a .vue file, its
 *  template's `t` is its script's. */
export function scanSource(parsers, file, text, from) {
  const uses = []
  const violations = []
  const scripts = []
  const expressions = []
  if (file.endsWith('.vue')) {
    if (!parsers.sfc) throw new Error(`${file}: Vue files need vue in the site.`)
    const { descriptor } = parsers.sfc.parse(text, { filename: file })
    for (const block of [descriptor.script, descriptor.scriptSetup])
      if (block)
        scripts.push({ code: block.content, line: block.loc.start.line - 1, lang: block.lang })
    if (descriptor.template?.ast) templateExpressions(descriptor.template.ast, expressions)
  } else scripts.push({ code: text, line: 0, lang: extname(file).slice(1) })

  const names = new Set()
  const programs = scripts.map((script) => {
    const program = parsers.babel.parse(script.code, {
      sourceType: 'module',
      plugins: script.lang?.endsWith('x') ? ['typescript', 'jsx'] : ['typescript'],
      errorRecovery: true,
    }).program
    for (const node of program.body)
      if (node.type === 'ImportDeclaration' && fromModule(node.source.value, from))
        for (const s of node.specifiers)
          if (s.type === 'ImportSpecifier' && (s.imported.name ?? s.imported.value) === 't')
            names.add(s.local.name)
    return { program, line: script.line }
  })
  if (!names.size) return { uses, violations }

  const visit = (node, line, scope) => walk(node, line, scope, uses, violations)
  for (const { program, line } of programs) visit(program, line, names)
  for (const expression of expressions) {
    let ast
    try {
      ast = parsers.babel.parseExpression(expression.code, { plugins: ['typescript'] })
    } catch {
      // An event handler may be statements: `a = 1; go()`.
      try {
        ast = parsers.babel.parse(expression.code, { plugins: ['typescript'] }).program
      } catch {
        continue
      }
    }
    visit(ast, expression.line, names)
  }
  return { uses, violations }
}

/** Whether an import specifier names the module `t` comes from: '~/utils/i18n', '../utils/i18n'
 *  and '@/utils/i18n.ts' all end in 'utils/i18n'. */
function fromModule(specifier, from) {
  const bare = specifier.replace(/\.(m?[jt]s)$/, '')
  return bare === from || bare.endsWith(`/${from}`)
}

function walk(node, line, names, uses, violations) {
  if (!node || typeof node.type !== 'string') return
  // A function whose parameter is called `t` has its own `t` inside it.
  // shortcut: only parameters hide the import, not a `const t` in a block; add once a site has one.
  if (FUNCTIONS.has(node.type)) {
    const own = node.params.flatMap(identifiers).filter((name) => names.has(name))
    if (own.length) names = new Set([...names].filter((name) => !own.includes(name)))
  }
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    names.has(node.callee.name)
  ) {
    const at = line + node.loc.start.line
    const arg = node.arguments[0]
    const key =
      arg?.type === 'StringLiteral'
        ? arg.value
        : arg?.type === 'TemplateLiteral' && !arg.expressions.length
          ? arg.quasis[0].value.cooked
          : undefined
    if (key === undefined)
      violations.push({ line: at, why: "the key must be a literal, such as t('nav.home')" })
    else if (!KEY.test(key)) violations.push({ line: at, why: `'${key}' is not a key` })
    else uses.push({ key, line: at })
  }
  for (const [name, value] of Object.entries(node)) {
    if (name === 'loc' || name === 'leadingComments' || name === 'trailingComments') continue
    if (Array.isArray(value)) for (const child of value) walk(child, line, names, uses, violations)
    else if (value && typeof value === 'object') walk(value, line, names, uses, violations)
  }
}

function identifiers(pattern) {
  if (!pattern) return []
  if (pattern.type === 'Identifier') return [pattern.name]
  if (pattern.type === 'AssignmentPattern') return identifiers(pattern.left)
  if (pattern.type === 'RestElement') return identifiers(pattern.argument)
  if (pattern.type === 'TSParameterProperty') return identifiers(pattern.parameter)
  if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(identifiers)
  if (pattern.type === 'ObjectPattern')
    return pattern.properties.flatMap((p) => identifiers(p.type === 'RestElement' ? p : p.value))
  return []
}

// Vue's template AST: 1 element, 5 interpolation, 7 directive. Each expression keeps its source
// and line. v-for's is "item in list"; only the list is an expression.
function templateExpressions(node, out) {
  if (node.type === 5) push(node.content, out)
  for (const prop of node.props ?? [])
    if (prop.type === 7 && prop.exp) {
      if (prop.name === 'for') {
        const list = /\s(?:in|of)\s([\s\S]+)$/.exec(prop.exp.content)?.[1]
        if (list) out.push({ code: list, line: prop.exp.loc.start.line - 1 })
      } else push(prop.exp, out)
    }
  for (const child of node.children ?? []) templateExpressions(child, out)
}

function push(expression, out) {
  if (expression && !expression.isStatic && expression.content?.trim())
    out.push({ code: expression.content, line: expression.loc.start.line - 1 })
}

/** Every script and Vue file under `dirs`, without node_modules, dot folders and `skip`. */
export async function listFiles(dirs, skip) {
  const files = []
  const visit = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && !entry.name.startsWith('.') && resolve(path) !== skip)
          await visit(path)
      } else if (
        entry.name.endsWith('.vue') ||
        (SCRIPTS.has(extname(entry.name)) && !entry.name.endsWith('.d.ts'))
      )
        files.push(path)
    }
  }
  for (const dir of dirs) if (existsSync(dir)) await visit(dir)
  return files.sort()
}

// ── Checking

/** What fails the build: violations, keys without a text in the source language, and keys that
 *  have one only in the draft. */
export function check(uses, violations, known, draft) {
  const problems = violations.map((v) => `${v.at}: ${v.why}`)
  const seen = new Set()
  for (const use of uses) {
    if (known.has(use.key) || seen.has(use.key)) continue
    seen.add(use.key)
    problems.push(
      draft?.has(use.key)
        ? `${use.at}: '${use.key}' exists only as a draft. Publish it in linguitas.`
        : `${use.at}: '${use.key}' does not exist. Create it in linguitas.`,
    )
  }
  return problems
}

// ── Talking to linguitas

async function request(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { ...init.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`)
  return response
}

/** The texts, key types and client to write: the published version, or the draft. */
async function fetchAll(served, api, token, draft) {
  const manifest = await (await request(api, null)).json()
  const client = await Promise.all(
    // Nuxt leaves .d.ts files out of what it serves, so the types travel as .d.ts.txt.
    ['client.js', 'client.d.ts.txt'].map(async (f) =>
      (await request(`${served}/${f}`, null)).text(),
    ),
  )
  if (draft) {
    const texts = await (await request(`${api}/draft`, token)).json()
    const keys = await (await request(`${api}/draft/keys.d.ts`, token)).text()
    return { manifest, texts, keys, client }
  }
  const version = manifest.version
  const entries = version
    ? await Promise.all(
        manifest.locales.map(async (l) => [
          l,
          await (await request(`${api}/${version}/${l}.json`, null)).json(),
        ]),
      )
    : []
  const keys = version ? await (await request(`${api}/${version}/keys.d.ts`, null)).text() : ''
  return {
    manifest,
    texts: { version, source: manifest.source, texts: Object.fromEntries(entries) },
    keys,
    client,
  }
}

// ── The command

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: 'string', default: process.env.LINGUITAS_URL },
      project: { type: 'string', default: process.env.LINGUITAS_PROJECT },
      token: { type: 'string', default: process.env.LINGUITAS_TOKEN },
      consumer: { type: 'string', default: process.env.LINGUITAS_CONSUMER },
      src: { type: 'string', multiple: true, default: ['app'] },
      out: { type: 'string', default: 'app/linguitas' },
      from: { type: 'string', default: 'linguitas/client' },
      draft: { type: 'boolean', default: false },
    },
  })
  const ci = !!process.env.CI
  if (!values.url || !values.project)
    return fail(['Name linguitas and the project: LINGUITAS_URL and LINGUITAS_PROJECT.'])
  if (values.draft && ci) return fail(['--draft is for development: CI builds what was published.'])
  if (values.draft && !values.token)
    return fail(['--draft needs the build token: LINGUITAS_TOKEN.'])
  if (ci && (!values.token || !values.consumer))
    return fail(['In CI, sync reports what it found: set LINGUITAS_TOKEN and --consumer.'])

  const root = process.cwd()
  const out = resolve(values.out)
  // Where linguitas serves its files, and the project's translations.
  const served = `${values.url.replace(/\/+$/, '')}/v1/translations`
  const api = `${served}/${values.project}`

  // 1. Scan.
  const parsers = await loadParsers(root)
  const uses = []
  const violations = []
  for (const file of await listFiles(
    values.src.map((d) => resolve(d)),
    out,
  )) {
    const name = relative(root, file)
    const found = scanSource(parsers, name, await readFile(file, 'utf8'), values.from)
    uses.push(...found.uses.map((u) => ({ key: u.key, at: `${name}:${u.line}` })))
    violations.push(...found.violations.map((v) => ({ why: v.why, at: `${name}:${v.line}` })))
  }

  // 2. Fetch, or go on with what was committed.
  let texts
  let version
  try {
    const fetched = await fetchAll(served, api, values.token, values.draft)
    await mkdir(out, { recursive: true })
    await writeFile(join(out, 'texts.json'), `${JSON.stringify(fetched.texts, null, 2)}\n`)
    await writeFile(join(out, 'keys.d.ts'), fetched.keys)
    await writeFile(join(out, 'client.js'), fetched.client[0])
    await writeFile(join(out, 'client.d.ts'), fetched.client[1])
    texts = fetched.texts
    version = fetched.manifest.version
    if (fetched.manifest.sync > VERSION)
      console.warn(
        `linguitas: a newer sync script is out. curl -o ${relative(root, process.argv[1])} ${served}/sync.mjs`,
      )
    console.log(
      `linguitas: ${values.draft ? 'the draft' : `version ${version}`}, ${Object.keys(texts.texts).join(', ') || 'no language'}`,
    )
  } catch (error) {
    console.warn(
      `linguitas: could not fetch (${error.message}); going on with ${relative(root, out)}.`,
    )
    try {
      texts = JSON.parse(await readFile(join(out, 'texts.json'), 'utf8'))
      version = texts.version
    } catch {
      texts = { version: 0, source: 'en', texts: {} }
      version = 0
    }
  }

  // 3. Check: a key exists when the source language has a text for it.
  const known = new Set(Object.keys(texts.texts[texts.source] ?? {}))
  let drafted
  if (!values.draft && values.token && uses.some((u) => !known.has(u.key)))
    drafted = await request(`${api}/draft`, values.token)
      .then(async (r) => {
        const draft = await r.json()
        return new Set(Object.keys(draft.texts[draft.source] ?? {}))
      })
      .catch(() => undefined)
  const problems = check(uses, violations, known, drafted)

  // 4. Report, in CI only: a branch on a laptop never rewrites what a site uses.
  if (ci) {
    const keys = [...new Set(uses.map((u) => u.key))].sort()
    try {
      await request(`${api}/report`, values.token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ consumer: values.consumer, version, sync: VERSION, keys }),
      })
      console.log(`linguitas: reported ${keys.length} keys as ${values.consumer}.`)
    } catch (error) {
      console.warn(`linguitas: could not report (${error.message}).`)
    }
  }

  if (problems.length) return fail(problems)
  console.log(`linguitas: ${new Set(uses.map((u) => u.key)).size} keys in use, all there.`)
}

function fail(problems) {
  for (const problem of problems) console.error(`linguitas: ${problem}`)
  process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => fail([error.message]))
