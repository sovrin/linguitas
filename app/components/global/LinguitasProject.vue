<script setup lang="ts">
import { errorMessage, formatCount, plural } from '#nexitas/app/lib/format'
import type { ProjectSummary } from '#nexitas/shared/contracts'
import { countProblems, type TranslationSpace } from '../../../shared/contracts'

/** linguitas' part of a project's page: its translations, or a way to start them. */
const props = defineProps<{ project: ProjectSummary }>()
const { data: space, error, refresh } = await useProjectFetch<TranslationSpace>('/translations')
// The project exists (its page saw to that), so a 404 means no translations yet.
const notStarted = computed(() => error.value?.statusCode === 404)
const problems = computed(() =>
  space.value ? countProblems(space.value.keys, space.value.live) : 0,
)

async function start() {
  await $fetch(`/api/p/${props.project.id}/translations`, { method: 'POST', body: {} })
  await refresh()
}
</script>

<template>
  <!-- Under the module's name and icon, which the project page puts above it. -->
  <AppAlert v-if="error && !notStarted" title="Could not load its translations.">{{
    errorMessage(error)
  }}</AppAlert>
  <p v-else-if="space" class="cluster gap-3">
    <span class="text-muted"
      >{{ plural(space.keys.length, 'key') }} in {{ space.live.join(', ') }}</span
    >
    <StateDot v-if="problems" tone="warning">{{ formatCount(problems) }} to check</StateDot>
    <StateDot v-if="space.unpublished" tone="warning">Changes not published</StateDot>
    <NuxtLink :to="`/p/${project.id}/translations`" class="link">Keys and API</NuxtLink>
  </p>
  <PanelStart
    v-else-if="notStarted"
    label="Start translations"
    failed="Could not start its translations."
    :start="start"
  >
    No translations yet. Start, and you get keys to write texts for in each language, and a build
    token for the sites that use them.
  </PanelStart>
</template>
