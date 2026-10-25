<script setup lang="ts">
import type { TranslationSpace } from '../../../../../shared/contracts'

// The project's keys, notes and texts as one linguitas file: all of it as a backup, or some
// languages and keys to hand a translator. Import takes the file back.
const project = useProject().id.value
const { data: space, error: loadError } = await useProjectFetch<TranslationSpace>('/translations', {
  live: false,
})
const locales = ref<string[]>([...(space.value?.locales ?? [])])
const prefix = ref('')
const needs = ref('')

const href = computed(() => {
  const query = new URLSearchParams({ locales: locales.value.join(',') })
  if (prefix.value.trim()) query.set('prefix', prefix.value.trim())
  if (needs.value) query.set('needs', needs.value)
  return `/api/p/${project}/translations/export?${query}`
})
</script>

<template>
  <AppPage title="Export" failed="Could not load the languages." :error="loadError">
    <form v-if="space" class="stack gap-5 measure" @submit.prevent>
      <fieldset class="stack gap-4">
        <div class="field">
          <span id="locales-label">Languages</span>
          <div class="cluster gap-4" role="group" aria-labelledby="locales-label">
            <label v-for="locale in space.locales" :key="locale" class="font-mono"
              ><input v-model="locales" type="checkbox" :value="locale" /> {{ locale }}</label
            >
          </div>
        </div>
        <div class="field">
          <label for="prefix">Keys starting with</label>
          <input
            id="prefix"
            v-model="prefix"
            class="input font-mono"
            data-size="s"
            placeholder="every key"
            spellcheck="false"
            aria-describedby="prefix-help"
          />
          <small id="prefix-help">Such as <span class="font-mono">help.</span></small>
        </div>
        <div class="field">
          <label for="needs">Only keys that need work in</label>
          <span class="select"
            ><select id="needs" v-model="needs" class="input" data-size="s">
              <option value="">Every key</option>
              <option
                v-for="locale in space.locales.filter((l) => l !== space!.source)"
                :key="locale"
                :value="locale"
              >
                {{ locale }}: missing, stale or with other placeholders
              </option>
            </select></span
          >
        </div>
      </fieldset>
      <p class="text-s text-muted">
        One JSON file with each key's note and its texts in the languages picked. Every language and
        key makes a full backup.
      </p>
      <div class="cluster gap-3 hairline-t pt-5">
        <a
          v-if="locales.length"
          :href="href"
          download
          class="btn end"
          data-size="s"
          data-variant="primary"
          >Download</a
        >
        <button v-else type="button" class="btn end" data-size="s" data-variant="primary" disabled>
          Download
        </button>
      </div>
    </form>
  </AppPage>
</template>
