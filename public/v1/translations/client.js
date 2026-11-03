// linguitas' client: `t()` over the texts a site's build fetched (sync writes this file beside
// them). New texts come with the next build. One set of texts per page or process; it fetches,
// keeps and reports nothing.

// {name}, {{name}} and ICU plurals ({count, plural, one {# bar} other {# bars}}), as linguitas'
// audit reads them.
const NAME = /^\{?\s*([A-Za-z0-9_.]+)\s*\}?$/
const PLURAL = /^\s*([A-Za-z0-9_.]+)\s*,\s*plural\s*,/
const FORM = /\s*(=\d+|[a-z]+)\s*\{/y

/** @type {import('./client').Texts} */
let current = { version: 0, source: 'en', texts: {} }
let locale = 'en'
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

/** Switches the language, to one of the build's. */
export function setLocale(next) {
  locale = next
  notify()
}

/** Calls `listener` whenever the language changes: to render again. */
export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify() {
  for (const listener of listeners) listener()
}
