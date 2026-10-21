import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// The tests import the core as the app does, through #nexitas (see nexitas' nuxt.config.ts).
export default defineConfig({
  resolve: {
    alias: { '#nexitas': resolve(import.meta.dirname, process.env.NEXITAS_DIR ?? '../nexitas') },
  },
  test: { include: ['tests/unit/**/*.test.ts'], testTimeout: 15_000 },
})
