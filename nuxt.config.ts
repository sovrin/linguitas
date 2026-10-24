import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// linguitas is a module of nexitas: a Nuxt layer that nexitas extends, as its modules.json lists it.
// The owner's sign-in, the /api guard, live updates, the database, projects and the page shell are
// nexitas'; this layer adds the translations: keys, their texts per language, and the API that
// delivers what was published. Everything here resolves from this folder, since the app around it
// is nexitas.
const root = dirname(fileURLToPath(import.meta.url))

export default defineNuxtConfig({
  compatibilityDate: '2026-09-06',
  // What only linguitas draws: the key tree's indent.
  css: [resolve(root, 'app/assets/app.css')],
  // nexitas allows its own files and aequitas'; these are linguitas' own.
  vite: { server: { fs: { allow: [root] } } },
})
