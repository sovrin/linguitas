<script setup lang="ts">
import { errorMessage } from '#nexitas/app/lib/format'
import type { ProjectSummary } from '#nexitas/shared/contracts'
import type { TranslationSpace } from '../../../shared/contracts'

/** linguitas' part of a project's page: how a site's build syncs the texts and how its code reads
 *  them, or a way to start translations. */
const props = defineProps<{ project: ProjectSummary }>()
const { data: space, error, refresh } = await useProjectFetch<TranslationSpace>('/translations')
// The project exists (its page saw to that), so a 404 means no translations yet.
const notStarted = computed(() => error.value?.statusCode === 404)
const origin = useRequestURL().origin
const buildSnippet = computed(() =>
  [
    `curl -o scripts/linguitas.mjs ${origin}/v1/translations/sync.mjs`,
    `LINGUITAS_URL=${origin} LINGUITAS_PROJECT=${props.project.id} \\`,
    `LINGUITAS_TOKEN=${space.value?.token ?? ''} node scripts/linguitas.mjs --consumer web`,
  ].join('\n'),
)
const siteSnippet = [
  `import texts from './linguitas/texts.json'`,
  `import { start, t, watch } from './linguitas/client'`,
  ``,
  `start(texts, { locale: 'de' })`,
  `watch({ url: '${origin}/v1/translations/${props.project.id}' })`,
  `t('checkout.pay')`,
].join('\n')

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
  <!-- Setup only: the overview and the sidebar tell how its translations stand. -->
  <div v-else-if="space" class="stack gap-3">
    <p>A site's build runs sync first; the build token is for CI, never for a page.</p>
    <EmbedCode :code="buildSnippet" />
    <p>The site starts with what sync fetched and reads newer published texts as it runs.</p>
    <EmbedCode :code="siteSnippet" />
  </div>
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
