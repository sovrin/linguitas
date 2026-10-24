// linguitas' client: `t()` over the texts a site's build fetched (sync writes this file beside
// them), and newer published versions picked up while the site runs, without a rebuild. One set of
// texts per page or process. It keeps nothing anywhere and reports nothing: what a site uses, its
// build reports.

// {name} and {{name}}, as linguitas' audit reads placeholders.
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}|\{\s*([A-Za-z0-9_.]+)\s*\}/g

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
 *  filled. A key without any text comes back as itself: the build fails before that ships. */
export function t(key, params) {
  const text = current.texts[locale]?.[key] ?? current.texts[current.source]?.[key] ?? key
  if (!params) return text
  return text.replace(PLACEHOLDER, (match, double, single) => {
    const name = double ?? single
    return Object.hasOwn(params, name) ? String(params[name]) : match
  })
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
