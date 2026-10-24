<script setup lang="ts">
import { errorMessage, formatAge, formatCount, formatTime, plural } from '#nexitas/app/lib/format'
import {
  CHECKS,
  SYNC_VERSION,
  missingKeys,
  type Check,
  type TranslationSpace,
} from '../../shared/contracts'
import type { Filter, State, TreeRow } from '../../shared/tree'

/** <KeyTree :selected="key"><template #aside>…</template></KeyTree>
 *  A project's translations as one tree of keys at their dots, any depth: each key with its source
 *  text and a strip of squares, one per language, for what is translated, what to check and what
 *  is missing, so any number of languages fits one column. The key in hand (`selected`) opens in
 *  the inspector the page puts in `aside` (and `danger`); without one, the inspector shows how
 *  sites get the texts and which keys their code uses. `aside-name` names the key in hand in the
 *  inspector's header. */
const props = defineProps<{ selected?: string; asideName?: string }>()
const slots = useSlots()
const project = useProject().id.value
const base = `/api/p/${project}/translations`
// Which keys show: an audit finding and a search, both in the address like the inbox's filters,
// so a reload, the back button and an opened key keep them. Besides the audit's checks, `unused`:
// keys no site's code uses, once a site has reported.
const route = useRoute()
const filter = computed<Filter>(() => {
  const asked = route.query.check
  if (asked === 'unused') return 'unused'
  return typeof asked === 'string' && asked in CHECKS ? (asked as Check) : 'all'
})
const q = computed(() => (typeof route.query.q === 'string' ? route.query.q.trim() : ''))
const within = (next: { check?: Filter; q?: string }) => {
  const check = next.check ?? filter.value
  const term = next.q ?? q.value
  return {
    query: { ...(check !== 'all' ? { check } : {}), ...(term ? { q: term } : {}) },
  }
}
const searchText = ref(q.value)
watch(q, (value) => (searchText.value = value))
const search = () => navigateTo(within({ q: searchText.value.trim() }))
// The tree opens folded, a search's or an audit tab's too, and only what is unfolded is fetched:
// the top level and the children of each open group. What is open lasts while the owner moves
// between the list and its keys, not past a reload.
const opened = useState<string[]>(`linguitas-open-${project}`, () => [])
// The key in hand stays in sight: the groups it is in unfold. A step that is no node (inside a
// joined chain like "form.errors") is simply not in the answer.
watch(
  () => props.selected,
  (key) => {
    const steps = key?.split('.').slice(0, -1) ?? []
    const paths = steps.map((_, index) => steps.slice(0, index + 1).join('.'))
    if (paths.some((path) => !opened.value.includes(path)))
      opened.value = [...new Set([...opened.value, ...paths])]
  },
  { immediate: true },
)
const [{ data: space, error, refresh }, { data: tree, status: treeStatus, refresh: refreshTree }] =
  await Promise.all([
    useProjectFetch<TranslationSpace>('/translations'),
    useProjectFetch<Record<string, TreeRow[]>>('/translations/tree', {
      query: {
        open: opened,
        check: computed(() => (filter.value === 'all' ? undefined : filter.value)),
        q: computed(() => q.value || undefined),
      },
    }),
  ])
// The project exists (the core's /p/[project] saw to that), so a 404 means not started.
const notStarted = computed(() => error.value?.statusCode === 404)
const source = computed(() => space.value?.source ?? '')
const reported = computed(() => !!space.value?.consumers.length)
const asked = computed(() => space.value?.asked ?? [])
const isOpen = (row: TreeRow) => !!tree.value?.[row.path]
// The group being unfolded or folded, busy until its rows are in.
const toggling = ref('')
function toggle(row: TreeRow) {
  toggling.value = row.path
  // Folding a group folds what is open inside it, so that is not fetched any more either.
  opened.value = isOpen(row)
    ? opened.value.filter((path) => path !== row.path && !path.startsWith(`${row.path}.`))
    : [...opened.value, row.path]
}
const rows = computed(() => {
  const out: { node: TreeRow; depth: number; parent: string }[] = []
  const walk = (list: TreeRow[], depth: number, parent: string) => {
    for (const row of list) {
      out.push({ node: row, depth, parent })
      const children = tree.value?.[row.path]
      if (row.branch && children) walk(children, depth + 1, row.path)
    }
  }
  walk(tree.value?.[''] ?? [], 0, '')
  return out
})
// One language of one key: translated, to check, or missing; a group shows the worst below it.
const STATE_WORDS: Record<State, string> = {
  done: 'translated',
  check: 'to check',
  missing: 'missing',
}
const targets = computed(
  () => space.value?.locales.filter((locale) => locale !== source.value) ?? [],
)
const problems = computed(() => space.value?.problems ?? 0)
// What needs the owner first: keys a build fails on, texts to check, then changes sites don't
// have yet.
const headline = computed(() => {
  if (asked.value.length) return `The code asks for ${missingKeys(asked.value.length)}`
  if (problems.value) return `${plural(problems.value, 'key')} to check`
  return space.value?.unpublished ? 'Changes wait to be published' : 'Everything is published'
})
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

// The publish history, newest first: an older version can go out again as the next one. That
// changes what sites get, so it asks first.
const again = ref<number>()
const confirmingAgain = ref(false)
const republishing = ref(false)
const republishError = ref('')
function askAgain(version: number) {
  again.value = version
  confirmingAgain.value = true
}
async function republish() {
  republishing.value = true
  republishError.value = ''
  try {
    await $fetch(`${base}/versions/${again.value}/publish`, { method: 'POST', body: {} })
    await refresh()
  } catch (cause) {
    republishError.value = errorMessage(cause)
  } finally {
    republishing.value = false
  }
}
// Forgetting a site removes its button, so focus moves on to the next site's.
const sitesList = ref<HTMLElement>()
const forgetting = ref('')
const forgetError = ref('')
async function forget(consumer: string, index: number) {
  forgetting.value = consumer
  forgetError.value = ''
  try {
    await $fetch(`${base}/consumers/${consumer}/delete`, { method: 'POST', body: {} })
    await Promise.all([refresh(), refreshTree()])
    await nextTick()
    const buttons = sitesList.value?.querySelectorAll<HTMLButtonElement>('button')
    buttons?.[Math.min(index, buttons.length - 1)]?.focus()
  } catch (cause) {
    forgetError.value = errorMessage(cause)
  } finally {
    forgetting.value = ''
  }
}

const rotating = ref(false)
const rotateError = ref('')
async function rotate() {
  rotating.value = true
  rotateError.value = ''
  try {
    await $fetch(`${base}/token`, { method: 'POST', body: {} })
    await refresh()
  } catch (cause) {
    rotateError.value = errorMessage(cause)
  } finally {
    rotating.value = false
  }
}
</script>

<template>
  <AppPage
    title="Translations"
    :aside-title="slots.aside ? 'Key' : 'Delivery'"
    :aside-name="asideName"
    :aside-close="
      slots.aside ? { path: `/p/${project}/translations`, query: route.query } : undefined
    "
    aside-mono
    failed="Could not load this project's translations."
    :error="notStarted ? undefined : error"
    :retry="refresh"
  >
    <template v-if="space" #actions>
      <NuxtLink :to="`/p/${project}/translations/_languages`" class="btn" data-size="s"
        >Languages</NuxtLink
      >
      <NuxtLink :to="`/p/${project}/translations/_import`" class="btn" data-size="s"
        >Import</NuxtLink
      >
      <NuxtLink :to="`/p/${project}/translations/_new`" class="btn" data-size="s">New key</NuxtLink>
    </template>

    <template v-if="space" #lead>
      <AppLead :title="headline">
        <template #meta>
          {{ formatCount(space.live.length) }} of
          {{ plural(space.locales.length, 'language') }} live · source
          <span class="font-mono">{{ source }}</span>
        </template>
      </AppLead>
    </template>
    <!-- What the audit found, as the inbox's filters: one choice at a time, with its count. -->
    <template v-if="space?.keyCount" #filters>
      <FilterLinks
        label="Show"
        :options="[
          {
            label: `All ${space.keyCount}`,
            to: within({ check: 'all' }),
            current: filter === 'all',
          },
          ...(Object.keys(CHECKS) as Check[]).map((check) => ({
            label: `${CHECKS[check]} ${space.checks[check]}`,
            to: within({ check }),
            current: filter === check,
          })),
          ...(reported
            ? [
                {
                  label: `Not in code ${space.unused}`,
                  to: within({ check: 'unused' }),
                  current: filter === 'unused',
                },
              ]
            : []),
        ]"
      />
      <SearchBox
        v-model="searchText"
        label="Search keys: a key's name or its source text"
        :maxlength="200"
        @search="search"
      />
    </template>
    <EmptyState v-if="notStarted">
      This project has no translations yet. Start them on
      <NuxtLink :to="`/p/${project}`" class="link">the project's page</NuxtLink>.
    </EmptyState>
    <!-- What a site's code asks for in vain: its build fails until each one is made. -->
    <AppSection v-if="asked.length" title="Missing keys">
      <DataTable>
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">Asked for by</th>
            <th scope="col"><span class="sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in asked" :key="item.key">
            <td class="font-mono text-s break-words">{{ item.key }}</td>
            <td class="font-mono text-s">{{ item.consumers.join(', ') }}</td>
            <td class="text-end">
              <NuxtLink
                :to="{ path: `/p/${project}/translations/_new`, query: { key: item.key } }"
                class="link text-s"
                >Create key</NuxtLink
              >
            </td>
          </tr>
        </tbody>
      </DataTable>
    </AppSection>
    <!-- The keys take the room; publishing and how sites read them sit beside them. -->
    <AppSection v-if="space" title="Keys">
      <!-- What the squares in the language columns mean. Each square already names its state to a
           screen reader, so this is for the eye. -->
      <p
        v-if="rows.length && targets.length"
        class="cluster gap-4 text-xs text-muted"
        aria-hidden="true"
      >
        <span v-for="(word, state) in STATE_WORDS" :key="state" class="cluster gap-2 flex-nowrap"
          ><span class="lang-state" :data-state="state"></span>{{ word }}</span
        >
        <span>A group shows the worst below it.</span>
      </p>
      <DataTable v-if="rows.length">
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col" class="source-col">
              <span class="font-mono">{{ source }}</span
              ><span class="text-muted"> · source</span>
            </th>
            <th v-if="targets.length" scope="col" class="lang-col">
              <!-- The codes over their squares: the same grid as every row's strip. -->
              <span class="lang-strip">
                <span
                  v-for="locale in targets"
                  :key="locale"
                  class="font-mono"
                  :class="{ 'text-muted': !space.live.includes(locale) }"
                  :data-tip="space.live.includes(locale) ? locale : `${locale} · draft`"
                  >{{ locale }}</span
                >
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.node.path"
            :aria-selected="row.node.path === props.selected || undefined"
          >
            <!-- One step in per level, with a hairline per ancestor to follow the depth by. -->
            <td class="key-cell" :style="{ '--depth': row.depth }">
              <span class="cluster gap-2 flex-nowrap min-w-0">
                <button
                  v-if="row.node.branch"
                  type="button"
                  class="btn key-toggle"
                  data-size="s"
                  data-variant="ghost"
                  :aria-expanded="isOpen(row.node)"
                  :disabled="treeStatus === 'pending' && toggling === row.node.path"
                  :aria-busy="(treeStatus === 'pending' && toggling === row.node.path) || undefined"
                  @click="toggle(row.node)"
                >
                  <i
                    class="icon text-muted"
                    :data-icon="isOpen(row.node) ? 'chevron-down' : 'chevron-right'"
                    aria-hidden="true"
                  ></i>
                  <span class="sr-only"
                    >{{ isOpen(row.node) ? 'Fold' : 'Unfold' }} {{ row.node.path }}</span
                  >
                </button>
                <span v-else class="key-spacer" aria-hidden="true"></span>
                <!-- The eye sees the last segment; a screen reader hears the whole key. Every
                     node opens, one in between too: without a text yet, it opens to get one. -->
                <NuxtLink
                  :to="{ path: `/p/${project}/translations/${row.node.path}`, query: route.query }"
                  class="link font-mono text-s nowrap"
                  :class="{ 'text-muted': !row.node.key }"
                  data-quiet
                  ><span v-if="row.parent" class="sr-only">{{ row.parent }}.</span
                  >{{ row.node.label }}</NuxtLink
                >
                <span v-if="row.node.branch" class="text-xs text-muted tabular nowrap">{{
                  row.node.below
                }}</span>
              </span>
            </td>
            <td class="source-col">
              <span v-if="row.node.key" class="stack gap-1 min-w-0">
                <span v-if="row.node.key.texts[source]" class="break-words">{{
                  row.node.key.texts[source]!.text
                }}</span>
                <StateDot v-else tone="warning" class="text-s">No source text</StateDot>
                <span v-if="row.node.key.note" class="text-xs text-muted break-words">{{
                  row.node.key.note
                }}</span>
              </span>
            </td>
            <td v-if="targets.length">
              <!-- One square per language, by shape as well as colour: filled is translated,
                   half is to check, empty is missing. A branch shows the worst below it. -->
              <span class="lang-strip">
                <span
                  v-for="locale in targets"
                  :key="locale"
                  class="lang-state"
                  role="img"
                  :data-state="row.node.states[locale]!"
                  :aria-label="`${locale}: ${STATE_WORDS[row.node.states[locale]!]}`"
                  :data-tip="`${locale}: ${STATE_WORDS[row.node.states[locale]!]}`"
                ></span>
              </span>
            </td>
          </tr>
        </tbody>
      </DataTable>
      <EmptyState v-else-if="space.keyCount">{{
        q
          ? `No key matches “${q}” here.`
          : filter === 'unused'
            ? "Every key is in a site's code."
            : 'Nothing to check here.'
      }}</EmptyState>
      <EmptyState v-else>No keys yet. Add one, or import a language file you have.</EmptyState>
    </AppSection>

    <template v-if="space" #aside>
      <slot v-if="slots.aside" name="aside" />
      <template v-else>
        <!-- The button beside what it changes; what sites get now is the History's. -->
        <AppSection v-if="space.unpublished || !space.publishedAt" title="Publish">
          <p v-if="!space.publishedAt" class="text-s text-muted">
            Nothing published yet: sites get a 404.
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
            Publishing delivers them as they are.
          </p>
          <div v-if="space.unpublished" class="cluster gap-2">
            <button
              type="button"
              class="btn"
              data-variant="primary"
              :disabled="publishing"
              :aria-busy="publishing || undefined"
              @click="publish"
            >
              Publish
            </button>
          </div>
          <AppAlert v-if="publishError" title="Could not publish.">{{ publishError }}</AppAlert>
        </AppSection>

        <AppSection v-if="space.versions.length" title="History">
          <ul class="stack gap-2 text-s" data-variant="plain">
            <li
              v-for="item in space.versions.slice(0, 6)"
              :key="item.version"
              class="cluster gap-3 justify-between"
            >
              <span
                >Version {{ item.version }}
                <span class="text-muted">· {{ formatTime(item.publishedAt) }}</span></span
              >
              <span v-if="item.version === space.version" class="text-muted">Sites get this</span>
              <button
                v-else
                type="button"
                class="link"
                :disabled="republishing"
                :aria-busy="(republishing && again === item.version) || undefined"
                @click="askAgain(item.version)"
              >
                Publish again
              </button>
            </li>
          </ul>
          <AppAlert v-if="republishError" title="Could not publish it again.">{{
            republishError
          }}</AppAlert>
          <ConfirmDialog
            v-model:open="confirmingAgain"
            :title="`Publish version ${again} again?`"
            confirm-label="Publish again"
            @confirm="republish"
          >
            <template #description
              >Sites get its texts as the next version, in place of what they get now.</template
            >
          </ConfirmDialog>
        </AppSection>

        <AppSection title="Sites">
          <p v-if="!space.consumers.length" class="text-s text-muted">
            No site has reported yet: sync in a site's CI reports the keys its code uses.
          </p>
          <ul v-else ref="sitesList" class="stack gap-3 text-s" data-variant="plain">
            <li
              v-for="(consumer, index) in space.consumers"
              :key="consumer.name"
              class="stack gap-1"
            >
              <span class="cluster gap-3 justify-between">
                <span class="font-mono weight-600">{{ consumer.name }}</span>
                <button
                  type="button"
                  class="link text-muted"
                  :disabled="!!forgetting"
                  :aria-busy="forgetting === consumer.name || undefined"
                  @click="forget(consumer.name, index)"
                >
                  Forget
                </button>
              </span>
              <span class="text-muted"
                >Built with version {{ consumer.version }}, reported
                {{ formatAge(consumer.reportedAt) }}</span
              >
              <StateDot v-if="consumer.sync < SYNC_VERSION" tone="warning"
                >Its sync script is old: fetch it again</StateDot
              >
            </li>
          </ul>
          <AppAlert v-if="forgetError" title="Could not forget the site.">{{
            forgetError
          }}</AppAlert>
        </AppSection>
      </template>
    </template>
    <template v-if="space && slots.danger" #danger><slot name="danger" /></template>
    <template v-else-if="space" #danger>
      <span>Replaces the build token; builds that sync with the old one fail.</span>
      <DangerAction
        label="Replace the build token"
        title="Replace the build token?"
        confirm-label="Replace token"
        :pending="rotating"
        @confirm="rotate"
      >
        Sites keep reading the published texts: they need no token.
      </DangerAction>
      <AppAlert v-if="rotateError" title="Could not replace the build token.">{{
        rotateError
      }}</AppAlert>
    </template>
  </AppPage>
</template>
