// linguitas' client: `t()` over the texts a site's build fetched (sync writes this file beside
// them), and newer published versions picked up while the site runs, without a rebuild. One set of
// texts per page or process. It keeps nothing anywhere and reports nothing: what a site uses, its
// build reports.

// {name}, {{name}} and ICU plurals ({count, plural, one {# bar} other {# bars}}), as linguitas'
// audit reads them.
const NAME = /^\{?\s*([A-Za-z0-9_.]+)\s*\}?$/
const PLURAL = /^\s*([A-Za-z0-9_.]+)\s*,\s*plural\s*,/
const FORM = /\s*(=\d+|[a-z]+)\s*\{/y

/** @type {import('./client').Texts} */
let current = { version: 0, source: 'en', texts: {} }
let locale = 'en'
/** @type {string | undefined} Where newer versions come from, once `watch` is called. */
let base
/** @type {Set<() => void>} */
const listeners = new Set()

/** Starts with the build's texts: `t()` works from here on, synchronously, offline. */
export function start(texts, options = {}) {
  current = texts
  locale = options.locale ?? texts.source
  notify()
}

/** A key's text in the current language, else in the source language, with its placeholders
 *  filled and its plurals chosen for the count. A key without any text comes back as itself: the
 *  build fails before that ships. */
export function t(key, params) {
  const own = current.texts[locale]?.[key]
  const text = own ?? current.texts[current.source]?.[key] ?? key
  return params ? fill(text, params, own === undefined ? current.source : locale) : text
}

function fill(text, params, lang) {
  let out = ''
  let from = 0
  for (let at = text.indexOf('{'); at >= 0; at = text.indexOf('{', from)) {
    const close = closing(text, at)
    if (close < 0) break
    out += text.slice(from, at) + part(text.slice(at + 1, close), text.slice(at, close + 1))
    from = close + 1
  }
  return out + text.slice(from)

  function part(inner, whole) {
    const plural = PLURAL.exec(inner)
    if (!plural) {
      const name = NAME.exec(inner)?.[1]
      return name && Object.hasOwn(params, name) ? String(params[name]) : whole
    }
    const count = Number(params[plural[1]])
    if (!Object.hasOwn(params, plural[1]) || Number.isNaN(count)) return whole
    const forms = {}
    let rest = inner.slice(plural[0].length)
    for (FORM.lastIndex = 0; ; FORM.lastIndex = 0) {
      const form = FORM.exec(rest)
      const end = form ? closing(rest, form[0].length - 1) : -1
      if (end < 0) break
      forms[form[1]] = rest.slice(form[0].length, end)
      rest = rest.slice(end + 1)
    }
    const chosen = forms[`=${count}`] ?? forms[rules(lang).select(count)] ?? forms.other
    if (chosen === undefined) return whole
    return fill(chosen.replaceAll('#', new Intl.NumberFormat(lang).format(count)), params, lang)
  }
}

function closing(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return i
  }
  return -1
}

const pluralRules = new Map()
function rules(lang) {
  if (!pluralRules.has(lang)) pluralRules.set(lang, new Intl.PluralRules(lang))
  return pluralRules.get(lang)
}

export function getLocale() {
  return locale
}

/** Switches the language. One the build did not bring is loaded first, once `watch` runs. */
export async function setLocale(next) {
  if (!current.texts[next] && base && current.version) {
    const texts = await load(`${base}/${current.version}/${next}.json`)
    if (texts) current = { ...current, texts: { ...current.texts, [next]: texts } }
  }
  locale = next
  notify()
}

/** Calls `listener` whenever the texts or the language change: to render again. */
export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Picks up newer published versions from `url` (`https://…/v1/translations/<project>`): in a
 *  browser on start and whenever the tab is shown again, on a server every `interval` ms. Checking
 *  is a 304 while nothing changed. Returns how to stop. */
export function watch({ url, interval = 60_000 }) {
  base = url.replace(/\/+$/, '')
  const check = () => update().catch(() => {})
  check()
  if (typeof document !== 'undefined') {
    const onShow = () => document.visibilityState === 'visible' && check()
    document.addEventListener('visibilitychange', onShow)
    return () => document.removeEventListener('visibilitychange', onShow)
  }
  const timer = setInterval(check, interval)
  timer.unref?.()
  return () => clearInterval(timer)
}

async function update() {
  const response = await fetch(base, { cache: 'no-cache' })
  if (!response.ok) return
  const manifest = await response.json()
  if (manifest.version <= current.version) return
  // The source and the language in use; others load when a site switches to them.
  const wanted = [...new Set([manifest.source, locale])].filter((l) => manifest.locales.includes(l))
  const texts = await Promise.all(wanted.map((l) => load(`${base}/${manifest.version}/${l}.json`)))
  if (texts.some((file) => !file)) return
  current = {
    version: manifest.version,
    source: manifest.source,
    texts: Object.fromEntries(wanted.map((l, i) => [l, texts[i]])),
  }
  notify()
}

async function load(url) {
  const response = await fetch(url)
  return response.ok ? response.json() : null
}

function notify() {
  for (const listener of listeners) listener()
}
