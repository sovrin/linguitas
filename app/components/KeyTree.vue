<script setup lang="ts">
import { errorMessage, formatAge, formatCount, formatTime, plural } from '#nexitas/app/lib/format'
import {
  CHECKS,
  SYNC_VERSION,
  missingKeys,
  audit,
  countProblems,
  type Check,
  type TextKey,
  type TranslationSpace,
} from '../../shared/contracts'
import { keyTree, keysUnder, type KeyNode } from '../lib/translations'

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
const { data: space, error, refresh } = await useProjectFetch<TranslationSpace>('/translations')
// The project exists (the core's /p/[project] saw to that), so a 404 means not started.
const notStarted = computed(() => error.value?.statusCode === 404)
const source = computed(() => space.value?.source ?? '')
const checksOf = (key: TextKey, locale: string) => audit(key, locale, source.value)
// Which keys show: an audit finding and a search, both in the address like the inbox's filters,
// so a reload, the back button and an opened key keep them.
const route = useRoute()
// Besides the audit's checks, `unused`: keys no site's code uses, once a site has reported.
type Filter = 'all' | Check | 'unused'
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
// A search matches a key's name or its source text, ignoring case.
const matches = (key: TextKey) => {
  if (!q.value) return true
  const term = q.value.toLowerCase()
  return (
    key.key.toLowerCase().includes(term) ||
    (key.texts[source.value]?.text.toLowerCase().includes(term) ?? false)
  )
}
const has = (key: TextKey, check: Check) =>
  space.value!.locales.some((locale) => checksOf(key, locale).includes(check))
const count = (check: Check) => space.value?.keys.filter((key) => has(key, check)).length ?? 0
const used = (key: TextKey) => !!space.value?.usage[key.key]
const unused = computed(() => space.value?.keys.filter((key) => !used(key)).length ?? 0)
const reported = computed(() => !!space.value?.consumers.length)
const shown = computed(
  () =>
    space.value?.keys.filter((key) => {
      if (!matches(key)) return false
      if (filter.value === 'all') return true
      if (filter.value === 'unused') return !used(key)
      return has(key, filter.value)
    }) ?? [],
)
// Keys a site's code uses that do not exist: its build fails until they do.
const asked = computed(() => {
  if (!space.value) return []
  const known = new Set(space.value.keys.map((key) => key.key))
  return Object.entries(space.value.usage)
    .filter(([key]) => !known.has(key))
    .map(([key, consumers]) => ({ key, consumers }))
})
// The keys as a tree at their dots, any depth. A group folds; an audit tab or a search shows every
// match open, so nothing it found stays folded away.
const tree = computed(() => keyTree(shown.value))
const collapsed = ref(new Set<string>())
const narrowed = computed(() => filter.value !== 'all' || !!q.value)
const isOpen = (node: KeyNode) => narrowed.value || !collapsed.value.has(node.path)
function toggle(node: KeyNode) {
  const next = new Set(collapsed.value)
  if (!next.delete(node.path)) next.add(node.path)
  collapsed.value = next
}
const branches = (nodes: KeyNode[]): string[] =>
  nodes.flatMap((node) => (node.children.length ? [node.path, ...branches(node.children)] : []))
const foldAll = () => (collapsed.value = new Set(branches(tree.value)))
const unfoldAll = () => (collapsed.value = new Set())
// What the owner folded stays folded on their next visit, in this browser only: a convenience,
// so a browser that keeps nothing simply opens everything.
const foldedKey = `linguitas-folded-${project}`
onMounted(() => {
  try {
    const kept = localStorage.getItem(foldedKey)
    if (kept) collapsed.value = new Set(JSON.parse(kept) as string[])
  } catch {}
  watch(collapsed, (value) => {
    try {
      localStorage.setItem(foldedKey, JSON.stringify([...value]))
    } catch {}
  })
})
const rows = computed(() => {
  const out: { node: KeyNode; depth: number; parent: string }[] = []
  const walk = (nodes: KeyNode[], depth: number, parent: string) => {
    for (const node of nodes) {
      out.push({ node, depth, parent })
      if (node.children.length && isOpen(node)) walk(node.children, depth + 1, node.path)
    }
  }
  walk(tree.value, 0, '')
  return out
})
// One language of one key: translated, to check (what the audit finds, bar "same as source"),
// or missing. A branch shows the worst of what is below it, so a gap shows before it is unfolded.
type State = 'done' | 'check' | 'missing'
const STATE_WORDS: Record<State, string> = {
  done: 'translated',
  check: 'to check',
  missing: 'missing',
}
const targets = computed(
  () => space.value?.locales.filter((locale) => locale !== source.value) ?? [],
)
function stateOf(key: TextKey, locale: string): State {
  if (!key.texts[locale]) return 'missing'
  return checksOf(key, locale).some((check) => check !== 'unchanged' && check !== 'missing')
    ? 'check'
    : 'done'
}
function branchState(node: KeyNode, locale: string): State {
  const states = keysUnder(node).map((key) => stateOf(key, locale))
  return states.includes('missing') ? 'missing' : states.includes('check') ? 'check' : 'done'
}
const problems = computed(() =>
  space.value ? countProblems(space.value.keys, space.value.live) : 0,
)
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
    await refresh()
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
    <template v-if="space?.keys.length" #filters>
      <FilterLinks
        label="Show"
        :options="[
          {
            label: `All ${space.keys.length}`,
            to: within({ check: 'all' }),
            current: filter === 'all',
          },
          ...(Object.keys(CHECKS) as Check[]).map((check) => ({
            label: `${CHECKS[check]} ${count(check)}`,
            to: within({ check }),
            current: filter === check,
          })),
          ...(reported
            ? [
                {
                  label: `Not in code ${unused}`,
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
      <template v-if="branches(tree).length && !narrowed" #actions>
        <button type="button" class="link" @click="unfoldAll">Unfold all</button>
        <button type="button" class="link" @click="foldAll">Fold all</button>
      </template>
      <!-- What the squares in the language columns mean. Each square already names its state to a
           screen reader, so this is for the eye. -->
      <p
        v-if="shown.length && targets.length"
        class="cluster gap-4 text-xs text-muted"
        aria-hidden="true"
      >
        <span v-for="(word, state) in STATE_WORDS" :key="state" class="cluster gap-2 flex-nowrap"
          ><span class="lang-state" :data-state="state"></span>{{ word }}</span
        >
        <span>A group shows the worst below it.</span>
      </p>
      <DataTable v-if="shown.length">
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col" class="source-col">
              <span class="font-mono">{{ source }}</span
              ><span class="text-muted"> · source</span>
            </th>
            <th v-if="targets.length" scope="col">
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
                  v-if="row.node.children.length"
                  type="button"
                  class="btn key-toggle"
                  data-size="s"
                  data-variant="ghost"
                  :aria-expanded="isOpen(row.node)"
                  :disabled="narrowed"
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
                <span v-if="row.node.children.length" class="text-xs text-muted tabular nowrap">{{
                  keysUnder(row.node).length
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
                  :data-state="
                    row.node.key && !row.node.children.length
                      ? stateOf(row.node.key, locale)
                      : branchState(row.node, locale)
                  "
                  :aria-label="`${locale}: ${
                    STATE_WORDS[
                      row.node.key && !row.node.children.length
                        ? stateOf(row.node.key, locale)
                        : branchState(row.node, locale)
                    ]
                  }`"
                  :data-tip="`${locale}: ${
                    STATE_WORDS[
                      row.node.key && !row.node.children.length
                        ? stateOf(row.node.key, locale)
                        : branchState(row.node, locale)
                    ]
                  }`"
                ></span>
              </span>
            </td>
          </tr>
        </tbody>
      </DataTable>
      <EmptyState v-else-if="space.keys.length">{{
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
