<script setup lang="ts">
import { errorMessage, formatCount, formatTime, plural } from '#nexitas/app/lib/format'
import {
  CHECKS,
  audit,
  countProblems,
  type Check,
  type TextKey,
  type TranslationSpace,
} from '../../../../../shared/contracts'
import { deliveryPath } from '../../../../lib/translations'

// A project's translations: every key in every language with what the audit finds, publishing,
// and the token and address its sites read them with.
const project = useProject().id.value
const base = `/api/p/${project}/translations`
const { data: space, error, refresh } = await useProjectFetch<TranslationSpace>('/translations')
// The project exists (the core's /p/[project] saw to that), so a 404 means not started.
const notStarted = computed(() => error.value?.statusCode === 404)
const origin = useRequestURL().origin
const snippet = computed(() =>
  space.value
    ? `curl -H "Authorization: Bearer ${space.value.token}" ${origin}${deliveryPath(project, space.value.source)}`
    : '',
)

const source = computed(() => space.value?.source ?? '')
const checksOf = (key: TextKey, locale: string) => audit(key, locale, source.value)
const filter = ref<'all' | Check>('all')
const has = (key: TextKey, check: Check) =>
  space.value!.locales.some((locale) => checksOf(key, locale).includes(check))
const count = (check: Check) => space.value?.keys.filter((key) => has(key, check)).length ?? 0
const shown = computed(() =>
  filter.value === 'all'
    ? (space.value?.keys ?? [])
    : (space.value?.keys.filter((key) => has(key, filter.value as Check)) ?? []),
)
const problems = computed(() =>
  space.value ? countProblems(space.value.keys, space.value.live) : 0,
)
// What the next publish changes about which languages sites can read.
const adds = computed(
  () => space.value?.live.filter((l) => !space.value!.delivered.includes(l)) ?? [],
)
const drops = computed(
  () => space.value?.delivered.filter((l) => !space.value!.live.includes(l)) ?? [],
)

const publishing = ref(false)
const publishError = ref('')
async function publish() {
  publishing.value = true
  publishError.value = ''
  try {
    await $fetch(`${base}/publish`, { method: 'POST', body: {} })
    await refresh()
  } catch (cause) {
    publishError.value = errorMessage(cause)
  } finally {
    publishing.value = false
  }
}

const rotateError = ref('')
async function rotate() {
  rotateError.value = ''
  try {
    await $fetch(`${base}/token`, { method: 'POST', body: {} })
    await refresh()
  } catch (cause) {
    rotateError.value = errorMessage(cause)
  }
}
</script>

<template>
  <AppPage
    title="Translations"
    failed="Could not load this project's translations."
    :error="notStarted ? undefined : error"
    :retry="refresh"
  >
    <template v-if="space" #subtitle>
      {{ plural(space.keys.length, 'key') }} · {{ formatCount(space.live.length) }} of
      {{ plural(space.locales.length, 'language') }} live, from
      <span class="font-mono">{{ source }}</span>
    </template>
    <template v-if="space" #actions>
      <NuxtLink :to="`/p/${project}/translations/_languages`" class="btn" data-size="s"
        >Languages</NuxtLink
      >
      <NuxtLink :to="`/p/${project}/translations/_import`" class="btn" data-size="s"
        >Import</NuxtLink
      >
      <NuxtLink :to="`/p/${project}/translations/_new`" class="btn" data-size="s">New key</NuxtLink>
    </template>

    <EmptyState v-if="notStarted">
      This project has no translations yet. Start them on
      <NuxtLink :to="`/p/${project}`" class="link">the project's page</NuxtLink>.
    </EmptyState>
    <!-- The keys take the room; publishing and how sites read them sit beside them. -->
    <AppSection v-else-if="space" title="Keys">
      <div
        v-if="space.keys.length"
        class="segmented"
        data-size="s"
        role="radiogroup"
        aria-label="Show"
      >
        <label
          ><input v-model="filter" type="radio" name="check" value="all" /><span
            >All {{ space.keys.length }}</span
          ></label
        >
        <label v-for="(label, check) in CHECKS" :key="check"
          ><input v-model="filter" type="radio" name="check" :value="check" /><span
            >{{ label }} {{ count(check) }}</span
          ></label
        >
      </div>
      <DataTable v-if="shown.length">
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th v-for="locale in space.locales" :key="locale" scope="col">
              <span class="font-mono">{{ locale }}</span>
              <span v-if="!space.live.includes(locale)" class="text-muted"> · draft</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="key in shown" :key="key.key">
            <td>
              <span class="stack gap-1 min-w-0">
                <NuxtLink
                  :to="`/p/${project}/translations/${key.key}`"
                  class="link font-mono text-s break-words"
                  >{{ key.key }}</NuxtLink
                >
                <span v-if="key.note" class="text-xs text-muted break-words">{{ key.note }}</span>
              </span>
            </td>
            <td v-for="locale in space.locales" :key="locale">
              <span class="stack gap-1 min-w-0">
                <span v-if="key.texts[locale]" class="text-s clamp-2 break-words">{{
                  key.texts[locale]!.text
                }}</span>
                <StateDot
                  v-for="check in checksOf(key, locale)"
                  :key="check"
                  class="text-s"
                  :tone="check === 'unchanged' ? undefined : 'warning'"
                  >{{ CHECKS[check] }}</StateDot
                >
              </span>
            </td>
          </tr>
        </tbody>
      </DataTable>
      <EmptyState v-else-if="space.keys.length">Nothing to check here.</EmptyState>
      <EmptyState v-else>No keys yet. Add one, or import a language file you have.</EmptyState>
    </AppSection>

    <template v-if="space" #aside>
      <AppSection title="Publish">
        <p class="text-s text-muted">
          <template v-if="space.publishedAt"
            >Sites get version {{ space.version }}, published
            {{ formatTime(space.publishedAt) }}.</template
          >
          <template v-else>Nothing published yet: sites get a 404.</template>
          {{ space.unpublished ? 'The texts have changed since.' : '' }}
        </p>
        <p v-if="adds.length" class="text-s text-muted">
          Publishing starts delivering
          <span class="font-mono">{{ adds.join(', ') }}</span
          >.
        </p>
        <p v-if="drops.length" class="text-s">
          <StateDot tone="warning"
            ><span
              >Publishing stops delivering <span class="font-mono">{{ drops.join(', ') }}</span
              >: sites asking for {{ drops.length === 1 ? 'it' : 'them' }} get a 404.</span
            ></StateDot
          >
        </p>
        <p v-if="problems && space.unpublished" class="text-s text-muted">
          {{ plural(problems, 'key') }} still to check. Publishing delivers them as they are.
        </p>
        <div class="cluster gap-2">
          <button
            type="button"
            class="btn"
            data-size="s"
            :data-variant="space.unpublished ? 'primary' : undefined"
            :disabled="publishing || !space.unpublished"
            :aria-busy="publishing || undefined"
            @click="publish"
          >
            Publish
          </button>
        </div>
        <AppAlert v-if="publishError" title="Could not publish.">{{ publishError }}</AppAlert>
      </AppSection>

      <AppSection title="API">
        <p class="text-s text-muted">
          Read-only, what was published only, from any origin. One language per request, its texts
          by key. Every request needs the token.
        </p>
        <EmbedCode :code="snippet" />
        <div class="cluster gap-2">
          <DangerAction
            label="Replace the token"
            title="Replace the token?"
            confirm-label="Replace token"
            @confirm="rotate"
          >
            Sites and builds that read with the old one get a 401 until they use the new one.
          </DangerAction>
        </div>
        <AppAlert v-if="rotateError" title="Could not replace the token.">{{
          rotateError
        }}</AppAlert>
      </AppSection>
    </template>
  </AppPage>
</template>
