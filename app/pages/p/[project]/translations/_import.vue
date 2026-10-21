<script setup lang="ts">
import { plural } from '#nexitas/app/lib/format'
import type { TranslationSpace } from '../../../../../shared/contracts'

// One language file into the project: its texts by key, flat or nested.
const project = useProject().id.value
const base = `/api/p/${project}/translations`
const { data: space, error: loadError } = await useProjectFetch<TranslationSpace>('/translations')
const locale = ref(space.value?.locales[0] ?? '')
const file = ref('')

const { pending, error, issues, fieldError, submit } = useSubmit()
const result = ref<{ added: number; changed: number; skipped: string[] } | null>(null)
async function save() {
  result.value = null
  let strings: unknown
  try {
    strings = JSON.parse(file.value)
  } catch {
    issues.value = []
    error.value = 'This is not JSON.'
    return
  }
  result.value =
    (await submit(() =>
      $fetch<{ added: number; changed: number; skipped: string[] }>(`${base}/import`, {
        method: 'POST',
        body: { locale: locale.value, strings },
      }),
    )) ?? null
}
</script>

<template>
  <AppPage title="Import" failed="Could not load the languages." :error="loadError">
    <form v-if="space" class="stack gap-5 measure" @submit.prevent="save">
      <fieldset :disabled="pending" class="stack gap-4">
        <div class="field">
          <label for="locale">Language</label>
          <span class="select"
            ><select id="locale" v-model="locale" class="input font-mono" data-size="s">
              <option v-for="option in space.locales" :key="option" :value="option">
                {{ option }}
              </option>
            </select></span
          >
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
            :aria-invalid="!!fieldError('strings') || undefined"
            aria-describedby="file-help"
          ></textarea>
          <small id="file-help"
            >A JSON object of texts by key, flat or nested, as i18n libraries keep them. Keys the
            project lacks are added; a text replaces the one there.</small
          >
          <span v-if="fieldError('strings')" data-error>{{ fieldError('strings') }}</span>
        </div>
      </fieldset>
      <FormIssues :error="error" :issues="issues" failed="Could not import." />
      <AppAlert v-if="result" tone="success" title="Imported.">
        {{ plural(result.added, 'key') }} added, {{ plural(result.changed, 'text') }} changed.
        <template v-if="result.skipped.length">
          Left out, as not a text or not a key:
          <span class="font-mono">{{ result.skipped.join(', ') }}</span
          >.
        </template>
        <NuxtLink :to="`/p/${project}/translations`" class="link">See the keys</NuxtLink>
      </AppAlert>
      <div class="cluster gap-3 hairline-t pt-5">
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
  </AppPage>
</template>
