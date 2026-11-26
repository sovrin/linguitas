<script setup lang="ts">
import { formatTime } from '#nexitas/app/lib/format'
import type { ChangesetSummary } from '#self/shared/contracts'

/** <ChangesetList :selected="name"><template #aside>…</template></ChangesetList>
 *  The project's changesets, open ones first: the key changes each feature needs, waiting apart
 *  from the draft until the owner applies them. The changeset in hand (`selected`) opens in the
 *  inspector the page puts in `aside` (and `danger`); without one, the inspector starts a new one. */
const props = defineProps<{ selected?: string }>()
const slots = useSlots()
const project = useProject().id.value
const base = `/api/p/${project}/translations`
const {
  data: changesets,
  error,
  refresh,
} = await useProjectFetch<ChangesetSummary[]>('/translations/changesets')
const to = (name: string) => `/p/${project}/translations/_changesets/${name}`

const name = ref('')
const note = ref('')
const { pending, error: createError, issues, fieldError, submit } = useSubmit()
async function create() {
  const done = await submit(() =>
    $fetch(`${base}/changesets`, {
      method: 'POST',
      body: { name: name.value.trim(), note: note.value },
    }),
  )
  if (!done) return
  const created = name.value.trim()
  name.value = ''
  note.value = ''
  await refresh()
  await navigateTo(to(created))
}
</script>

<template>
  <AppPage
    title="Changesets"
    :aside-title="slots.aside ? undefined : 'New changeset'"
    :aside-name="props.selected"
    :aside-close="slots.aside ? `/p/${project}/translations/_changesets` : undefined"
    aside-mono
    failed="Could not load the changesets."
    :error="error"
    :retry="refresh"
  >
    <template v-if="changesets">
      <p class="text-s text-muted measure">
        A changeset holds the key changes a feature needs, apart from the draft, while the feature
        is built. Apply it when the feature goes live, then publish.
      </p>
      <DataTable v-if="changesets.length">
        <thead>
          <tr>
            <th scope="col">Changeset</th>
            <th scope="col">State</th>
            <th scope="col" data-num>Changes</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in changesets"
            :key="item.name"
            :aria-selected="item.name === props.selected || undefined"
          >
            <td>
              <span class="stack gap-1 min-w-0">
                <NuxtLink :to="to(item.name)" class="link font-mono text-s break-words">{{
                  item.name
                }}</NuxtLink>
                <span v-if="item.note" class="text-xs text-muted break-words">{{ item.note }}</span>
              </span>
            </td>
            <td class="text-s">
              <StateDot v-if="item.appliedAt" tone="success"
                >Applied {{ formatTime(item.appliedAt) }}</StateDot
              >
              <StateDot v-else-if="item.pending < item.changes" tone="warning"
                >Removals wait</StateDot
              >
              <StateDot v-else>Open</StateDot>
            </td>
            <td data-num class="nowrap">
              <template v-if="item.appliedAt || item.pending === item.changes">{{
                item.changes
              }}</template>
              <template v-else>{{ item.pending }} of {{ item.changes }} wait</template>
            </td>
          </tr>
        </tbody>
      </DataTable>
      <EmptyState v-else
        >No changesets yet. Start one for a feature, or let an assistant start it over
        MCP.</EmptyState
      >
    </template>

    <template v-if="changesets" #aside>
      <slot v-if="slots.aside" name="aside" />
      <form v-else class="stack gap-4" @submit.prevent="create">
        <fieldset :disabled="pending" class="stack gap-4">
          <div class="field">
            <label for="changeset-name">Name</label>
            <input
              id="changeset-name"
              v-model="name"
              class="input font-mono text-s"
              data-size="s"
              required
              maxlength="80"
              autocomplete="off"
              spellcheck="false"
              :aria-invalid="!!fieldError('name') || undefined"
              aria-describedby="changeset-name-help"
            />
            <small id="changeset-name-help"
              >Like the feature's branch, such as feat/checkout · a build reads it with sync
              --changeset</small
            >
            <span v-if="fieldError('name')" data-error>{{ fieldError('name') }}</span>
          </div>
          <div class="field">
            <label for="changeset-note">Note</label>
            <input
              id="changeset-note"
              v-model="note"
              class="input"
              data-size="s"
              maxlength="500"
              aria-describedby="changeset-note-help"
            />
            <small id="changeset-note-help">What the feature is</small>
          </div>
        </fieldset>
        <FormIssues :error="createError" :issues="issues" failed="Could not start the changeset." />
        <div class="cluster gap-3 hairline-t pt-5">
          <button
            type="submit"
            class="btn end"
            data-size="s"
            data-variant="primary"
            :disabled="pending"
            :aria-busy="pending || undefined"
          >
            Start changeset
          </button>
        </div>
      </form>
    </template>
    <template v-if="changesets && slots.danger" #danger><slot name="danger" /></template>
  </AppPage>
</template>
