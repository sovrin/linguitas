<script setup lang="ts">
import { errorMessage } from '#nexitas/app/lib/format'
import {
  CHECKS,
  audit,
  countProblems,
  type Check,
  type TextKey,
  type TranslationSpace,
} from '../../../../../shared/contracts'
import { deliveryPath, longDate } from '../../../../lib/translations'

// A project's translations: every key in every language with what the audit finds, publishing,
// and the token and address its sites read them with.
const project = useProject().id.value
useHead({ title: `${project} · Translations · ${useRuntimeConfig().public.nexitas.name}` })
const base = `/api/p/${project}/translations`
const { data: space, error, refresh } = await useFetch<TranslationSpace>(base)
useLive(refresh)
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

const rotateOpen = ref(false)
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
  <div class="stack gap-5">
    <!-- The project exists (the core's /p/[project] saw to that), so a 404 means not started. -->
    <template v-if="error?.statusCode === 404">
      <h1 class="text-xl weight-600">Translations</h1>
      <p class="text-muted">
        This project has no translations yet. Start them on
        <NuxtLink :to="`/p/${project}`" class="link">the project's page</NuxtLink>.
      </p>
    </template>
    <div v-else-if="error" class="alert" data-tone="danger" role="alert">
      <div>
        <strong>Could not load this project's translations.</strong> {{ errorMessage(error) }}
      </div>
    </div>
    <template v-else-if="space">
      <div class="page-header">
        <div class="stack gap-1 min-w-0">
          <h1 class="text-xl weight-600">{{ space.name }}</h1>
          <p class="text-s text-muted">
            {{ space.keys.length }} {{ space.keys.length === 1 ? 'key' : 'keys' }} ·
            {{ space.live.length }} of {{ space.locales.length }}
            {{ space.locales.length === 1 ? 'language' : 'languages' }} live, from
            <span class="font-mono">{{ source }}</span>
          </p>
        </div>
        <div class="cluster gap-2">
          <NuxtLink :to="`/p/${project}/translations/_languages`" class="btn" data-size="s"
            >Languages</NuxtLink
          >
          <NuxtLink :to="`/p/${project}/translations/_import`" class="btn" data-size="s"
            >Import</NuxtLink
          >
          <NuxtLink :to="`/p/${project}/translations/_new`" class="btn" data-size="s"
            >New key</NuxtLink
          >
        </div>
      </div>

      <!-- The keys take the room; publishing and how sites read them sit beside them. -->
      <div class="with-aside">
        <section class="stack gap-3 min-w-0" aria-labelledby="keys-title">
          <h2 id="keys-title" class="text-s weight-600 hairline-b pb-2">Keys</h2>
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
          <div v-if="shown.length" class="table-scroll">
            <table class="table" data-size="s">
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
                      <span v-if="key.note" class="text-xs text-muted break-words">{{
                        key.note
                      }}</span>
                    </span>
                  </td>
                  <td v-for="locale in space.locales" :key="locale">
                    <span class="stack gap-1 min-w-0">
                      <span v-if="key.texts[locale]" class="text-s clamp-2 break-words">{{
                        key.texts[locale]!.text
                      }}</span>
                      <span v-for="check in checksOf(key, locale)" :key="check" class="cluster">
                        <span
                          class="badge"
                          :data-tone="check === 'unchanged' ? undefined : 'warning'"
                          >{{ CHECKS[check] }}</span
                        >
                      </span>
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else-if="space.keys.length" class="text-s text-muted">Nothing to check here.</p>
          <p v-else class="text-s text-muted">
            No keys yet. Add one, or import a language file you have.
          </p>
        </section>

        <aside class="stack gap-5">
          <section class="stack gap-3" aria-labelledby="publish-title">
            <h2 id="publish-title" class="text-s weight-600 hairline-b pb-2">Publish</h2>
            <p class="text-s text-muted">
              <template v-if="space.publishedAt"
                >Sites get version {{ space.version }}, published
                {{ longDate(space.publishedAt) }}.</template
              >
              <template v-else>Nothing published yet: sites get a 404.</template>
              {{ space.unpublished ? 'The texts have changed since.' : '' }}
            </p>
            <p v-if="adds.length" class="text-s text-muted">
              Publishing starts delivering
              <span class="font-mono">{{ adds.join(', ') }}</span
              >.
            </p>
            <p v-if="drops.length" class="text-s text-warning">
              Publishing stops delivering
              <span class="font-mono">{{ drops.join(', ') }}</span
              >: sites asking for {{ drops.length === 1 ? 'it' : 'them' }} get a 404.
            </p>
            <p v-if="problems && space.unpublished" class="text-s text-muted">
              {{ problems }} {{ problems === 1 ? 'key' : 'keys' }} still to check. Publishing
              delivers them as they are.
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
            <div v-if="publishError" class="alert" data-tone="danger" role="alert">
              <div><strong>Could not publish.</strong> {{ publishError }}</div>
            </div>
          </section>

          <section class="stack gap-3" aria-labelledby="api-title">
            <h2 id="api-title" class="text-s weight-600 hairline-b pb-2">API</h2>
            <p class="text-s text-muted">
              Read-only, what was published only, from any origin. One language per request, its
              texts by key. Every request needs the token.
            </p>
            <EmbedCode :code="snippet" caption="Shell" />
            <div class="cluster gap-2">
              <button
                type="button"
                class="btn"
                data-size="s"
                data-variant="ghost"
                data-tone="danger"
                @click="rotateOpen = true"
              >
                Replace the token
              </button>
            </div>
            <div v-if="rotateError" class="alert" data-tone="danger" role="alert">
              <div><strong>Could not replace the token.</strong> {{ rotateError }}</div>
            </div>
          </section>
        </aside>
      </div>
    </template>

    <ConfirmDialog
      v-model:open="rotateOpen"
      title="Replace the token?"
      confirm-label="Replace token"
      tone="danger"
      @confirm="rotate"
    >
      <template #description
        >Sites and builds that read with the old one get a 401 until they use the new one.</template
      >
    </ConfirmDialog>
  </div>
</template>
