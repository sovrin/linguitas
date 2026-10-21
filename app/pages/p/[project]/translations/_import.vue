<script setup lang="ts">
import { errorMessage } from '#nexitas/app/lib/format'
import type { TranslationSpace } from '../../../../../shared/contracts'

// One language file into the project: its texts by key, flat or nested.
const project = useProject().id.value
useHead({ title: `Import · ${useRuntimeConfig().public.nexitas.name}` })
const base = `/api/p/${project}/translations`
const { data: space, error: loadError } = await useFetch<TranslationSpace>(base)
const locale = ref(space.value?.locales[0] ?? '')
const file = ref('')

const pending = ref(false)
const error = ref('')
const result = ref<{ added: number; changed: number; skipped: string[] } | null>(null)
async function save() {
  error.value = ''
  result.value = null
  let strings: unknown
  try {
    strings = JSON.parse(file.value)
  } catch {
    error.value = 'This is not JSON.'
    return
  }
  pending.value = true
  try {
    result.value = await $fetch(`${base}/import`, {
      method: 'POST',
      body: { locale: locale.value, strings },
    })
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="stack gap-5">
    <nav aria-label="Breadcrumb">
      <ol class="breadcrumb">
        <li><NuxtLink :to="`/p/${project}/translations`">Translations</NuxtLink></li>
        <li aria-current="page">Import</li>
      </ol>
    </nav>
    <div class="page-header">
      <h1 class="text-xl weight-600">Import</h1>
    </div>
    <div v-if="loadError" class="alert" data-tone="danger" role="alert">
      <div><strong>Could not load the languages.</strong> {{ errorMessage(loadError) }}</div>
    </div>
    <form v-else-if="space" class="stack gap-5 measure" @submit.prevent="save">
      <fieldset :disabled="pending" class="stack gap-4">
        <div class="field">
          <label for="locale">Language</label>
          <select id="locale" v-model="locale" class="select font-mono">
            <option v-for="option in space.locales" :key="option" :value="option">
              {{ option }}
            </option>
          </select>
        </div>
        <div class="field">
          <label for="file">Texts</label>
          <textarea
            id="file"
            v-model="file"
            class="input font-mono text-s"
            rows="14"
            required
            spellcheck="false"
            aria-describedby="file-help"
          ></textarea>
          <small id="file-help"
            >A JSON object of texts by key, flat or nested, as i18n libraries keep them. Keys the
            project lacks are added; a text replaces the one there.</small
          >
        </div>
      </fieldset>
      <div v-if="error" class="alert" data-tone="danger" role="alert">
        <div><strong>Could not import.</strong> {{ error }}</div>
      </div>
      <div v-if="result" class="alert" data-tone="success" role="status">
        <div>
          <strong>Imported.</strong> {{ result.added }} keys added, {{ result.changed }} texts
          changed.
          <template v-if="result.skipped.length">
            Left out, as not a text or not a key:
            <span class="font-mono">{{ result.skipped.join(', ') }}</span
            >.
          </template>
          <NuxtLink :to="`/p/${project}/translations`" class="link">See the keys</NuxtLink>
        </div>
      </div>
      <div class="cluster gap-3">
        <button
          type="submit"
          class="btn end"
          data-size="s"
          data-variant="primary"
          :disabled="pending"
          :aria-busy="pending || undefined"
        >
          Import
        </button>
      </div>
    </form>
  </div>
</template>
