<script setup lang="ts">
import { errorMessage } from '#nexitas/app/lib/format'
import type { ProjectSummary } from '#nexitas/shared/contracts'
import { countProblems, type TranslationSpace } from '../../../shared/contracts'

/** linguitas' part of a project's page: its translations, or a way to start them. */
const props = defineProps<{ project: ProjectSummary }>()
const base = `/api/p/${props.project.id}/translations`
const { data: space, error, refresh } = await useFetch<TranslationSpace>(base)
useLive(refresh)
// The project exists (its page saw to that), so a 404 means no translations yet.
const notStarted = computed(() => error.value?.statusCode === 404)
const problems = computed(() =>
  space.value ? countProblems(space.value.keys, space.value.live) : 0,
)

const pending = ref(false)
const startError = ref('')
async function start() {
  pending.value = true
  startError.value = ''
  try {
    await $fetch(base, { method: 'POST', body: {} })
    await refresh()
  } catch (cause) {
    startError.value = errorMessage(cause)
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <!-- Under the module's name and icon, which the project page puts above it. -->
  <div class="stack gap-3">
    <div v-if="error && !notStarted" class="alert" data-tone="danger" role="alert">
      <div><strong>Could not load its translations.</strong> {{ errorMessage(error) }}</div>
    </div>
    <template v-else-if="space">
      <p class="cluster gap-3 text-s">
        <span class="text-muted"
          >{{ space.keys.length }} {{ space.keys.length === 1 ? 'key' : 'keys' }} in
          {{ space.live.join(', ') }}</span
        >
        <span v-if="problems" class="badge" data-tone="warning">{{ problems }} to check</span>
        <span v-if="space.unpublished" class="badge" data-tone="warning">Not published</span>
        <NuxtLink :to="`/p/${project.id}/translations`" class="link">Keys and API</NuxtLink>
      </p>
    </template>
    <template v-else-if="notStarted">
      <p class="text-s text-muted">
        No translations yet. Start, and you get keys to write texts for in each language, and a
        token to read what you publish.
      </p>
      <p>
        <button
          type="button"
          class="btn"
          data-size="s"
          :disabled="pending"
          :aria-busy="pending || undefined"
          @click="start"
        >
          Start translations
        </button>
      </p>
      <div v-if="startError" class="alert" data-tone="danger" role="alert">
        <div><strong>Could not start its translations.</strong> {{ startError }}</div>
      </div>
    </template>
  </div>
</template>
