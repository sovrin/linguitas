<script setup lang="ts">
import { errorMessage, formatTime, plural } from '#nexitas/app/lib/format'
import {
  CHECKS,
  audit,
  type Change,
  type ChangesetView,
  type TextKey,
} from '#self/shared/contracts'
import ChangesetList from '#self/app/components/ChangesetList.vue'

// One changeset beside the list: its changes as before and after, a key to change in it, and
// applying it to the draft. A name like feat/checkout spans path segments, hence [...name].
const route = useRoute()
const project = useProject().id.value
const name = ([] as string[]).concat(route.params.name ?? []).join('/')
const base = `/api/p/${project}/translations`
const api = `${base}/changesets/${encodeURIComponent(name)}`
const { data, error, refresh } = await useProjectFetch<ChangesetView>(
  `/translations/changesets/${encodeURIComponent(name)}`,
)
const pending = computed(() => data.value?.changeset.changes.filter((c) => !c.appliedAt) ?? [])
const applied = computed(() => data.value?.changeset.changes.filter((c) => c.appliedAt) ?? [])
const OPS: Record<Change['op'], string> = { add: 'Add', update: 'Update', remove: 'Remove' }
const findings = (change: Change, locale: string) => {
  const after = data.value?.after[change.key]
  return after ? audit(after, locale, data.value!.source) : []
}
const before = (change: Change, locale: string) =>
  data.value?.before[change.key]?.texts[locale]?.text ?? ''
const conflictsOf = (key: string) => data.value?.conflicts.filter((c) => c.key === key) ?? []

// The key being changed: as the changeset would leave it, or as the draft has it, or new.
const keyName = ref('')
const editing = ref<{ key: string; textKey: TextKey | null; inDraft: boolean }>()
const { pending: loading, error: editError, submit } = useSubmit()
async function edit(key: string) {
  const found = await submit(() =>
    $fetch<{ key: TextKey | null }>(`${base}/keys/${encodeURIComponent(key)}`),
  )
  if (!found) return
  const after = data.value?.after[key]
  editing.value = {
    key,
    textKey: after !== undefined ? after : found.key,
    inDraft: !!found.key,
  }
}
async function saved() {
  editing.value = undefined
  keyName.value = ''
  await refresh()
}

const working = ref('')
const workError = ref('')
async function send(path: string, body: object, what: string) {
  working.value = what
  workError.value = ''
  try {
    await $fetch(`${api}/${path}`, { method: 'POST', body })
    await refresh()
    return true
  } catch (cause) {
    workError.value = errorMessage(cause)
    return false
  } finally {
    working.value = ''
  }
}
async function removeKey(key: string) {
  if (await send('changes', { changes: [{ op: 'remove', key }] }, `remove ${key}`)) saved()
}
const drop = (key: string) => send('drop', { key }, `drop ${key}`)

// Applying writes every pending change into the draft at once; sites get it with the next publish.
const removeUsed = ref(false)
const confirming = ref(false)
const appliedNotice = ref(false)
async function apply() {
  appliedNotice.value = await send('apply', { removeUsed: removeUsed.value }, 'apply')
}

const deleting = ref(false)
const deleteError = ref('')
async function remove() {
  deleting.value = true
  deleteError.value = ''
  try {
    await $fetch(`${api}/delete`, { method: 'POST', body: {} })
    await navigateTo(`/p/${project}/translations/_changesets`)
  } catch (cause) {
    deleteError.value = errorMessage(cause)
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <ChangesetList :selected="name">
    <template #aside>
      <AppAlert v-if="error" title="Could not load this changeset."
        >{{ errorMessage(error) }}
        <template #actions>
          <button type="button" class="btn" data-size="s" @click="refresh()">Try again</button>
        </template>
      </AppAlert>
      <template v-else-if="data">
        <div class="stack gap-1">
          <p v-if="data.changeset.note" class="text-s break-words">{{ data.changeset.note }}</p>
          <p class="text-s text-muted">
            Started {{ formatTime(data.changeset.createdAt) }}
            <template v-if="data.changeset.appliedAt">
              · applied {{ formatTime(data.changeset.appliedAt) }}</template
            >
          </p>
        </div>
        <AppAlert v-if="appliedNotice" tone="success" title="Applied to the draft."
          >Sites get it with the next publish.
          <template #actions>
            <NuxtLink :to="`/p/${project}/translations`" class="btn" data-size="s"
              >Publish</NuxtLink
            >
          </template>
        </AppAlert>
        <AppAlert v-if="data.conflicts.length" title="The draft changed under this changeset."
          >Change those keys here again, as they should be now, or drop their changes; then
          apply.</AppAlert
        >
        <AppAlert v-if="workError" title="Could not change the changeset.">{{
          workError
        }}</AppAlert>

        <AppSection v-if="pending.length" title="Waiting">
          <ul class="stack gap-4 text-s" data-variant="plain">
            <li v-for="change in pending" :key="change.key" class="stack gap-2">
              <span class="cluster gap-3 justify-between">
                <span class="cluster gap-2 min-w-0">
                  <span class="font-mono weight-600 break-words">{{ change.key }}</span>
                  <span class="text-muted">{{ OPS[change.op] }}</span>
                </span>
                <span class="cluster gap-3">
                  <button
                    v-if="change.op !== 'remove'"
                    type="button"
                    class="link"
                    :disabled="loading"
                    @click="edit(change.key)"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    class="link text-muted"
                    :disabled="!!working"
                    :aria-busy="working === `drop ${change.key}` || undefined"
                    @click="drop(change.key)"
                  >
                    Drop
                  </button>
                </span>
              </span>
              <StateDot v-for="c in conflictsOf(change.key)" :key="c.why" tone="warning">{{
                c.why
              }}</StateDot>
              <StateDot v-if="data.held.some((h) => h.key === change.key)" tone="warning"
                >Used by
                <span class="font-mono">{{
                  data.held.find((h) => h.key === change.key)!.consumers.join(', ')
                }}</span></StateDot
              >
              <span v-if="change.note !== null" class="text-muted break-words"
                >Note: {{ change.note }}</span
              >
              <span
                v-for="(text, locale) in change.texts"
                :key="locale"
                class="stack gap-1 min-w-0"
              >
                <span
                  ><span class="font-mono">{{ locale }}</span>
                  <span v-if="before(change, locale)" class="text-muted">
                    · was “{{ before(change, locale) }}”</span
                  ></span
                >
                <span class="break-words">{{ text || '(removed)' }}</span>
                <span v-if="findings(change, locale).length" class="cluster gap-2">
                  <StateDot
                    v-for="check in findings(change, locale)"
                    :key="check"
                    :tone="check === 'unchanged' ? undefined : 'warning'"
                    >{{ CHECKS[check] }}</StateDot
                  >
                </span>
              </span>
            </li>
          </ul>
        </AppSection>

        <AppSection v-if="!data.changeset.appliedAt" title="Change a key">
          <template v-if="editing">
            <p class="text-s text-muted">
              <span class="font-mono">{{ editing.key }}</span>
              {{ editing.textKey ? '' : '· a new key' }}
            </p>
            <KeyForm
              :key="editing.key"
              :project-id="project"
              :locales="data.locales"
              :text-key="editing.textKey ?? undefined"
              :name="editing.key"
              :changeset="name"
              @saved="saved"
            />
            <p class="cluster gap-3">
              <button
                v-if="editing.inDraft"
                type="button"
                class="link text-s"
                :disabled="!!working"
                :aria-busy="working === `remove ${editing.key}` || undefined"
                @click="removeKey(editing.key)"
              >
                Remove this key with the changeset
              </button>
              <button type="button" class="link text-muted text-s" @click="editing = undefined">
                Cancel
              </button>
            </p>
          </template>
          <form v-else class="cluster gap-2" @submit.prevent="edit(keyName.trim())">
            <label for="change-key" class="sr-only">Key</label>
            <input
              id="change-key"
              v-model="keyName"
              class="input font-mono text-s"
              data-size="s"
              required
              maxlength="120"
              autocomplete="off"
              spellcheck="false"
              placeholder="checkout.title"
            />
            <button
              type="submit"
              class="btn"
              data-size="s"
              :disabled="loading"
              :aria-busy="loading || undefined"
            >
              Change
            </button>
          </form>
          <AppAlert v-if="editError" title="Could not open the key.">{{ editError }}</AppAlert>
        </AppSection>

        <AppSection v-if="pending.length" title="Apply">
          <p class="text-s text-muted">
            Writes {{ plural(pending.length, 'change') }} into the draft at once, when the feature
            goes live. Publishing stays a step of its own.
          </p>
          <template v-if="data.held.length">
            <p class="text-s text-muted">
              Removing a key sites' code still uses waits until a build reports it unused, so the
              changeset stays open for it.
            </p>
            <label class="text-s"
              ><input v-model="removeUsed" type="checkbox" /> Remove them all the same</label
            >
          </template>
          <div class="cluster gap-2">
            <button
              type="button"
              class="btn"
              :data-variant="editing ? undefined : 'primary'"
              :disabled="!!working || !!data.conflicts.length"
              :aria-busy="working === 'apply' || undefined"
              @click="confirming = true"
            >
              Apply
            </button>
          </div>
          <ConfirmDialog
            v-model:open="confirming"
            :title="`Apply ${name}?`"
            confirm-label="Apply"
            @confirm="apply"
          >
            <template #description
              >Its changes go into the draft, and sites get them with the next publish.</template
            >
          </ConfirmDialog>
        </AppSection>

        <AppSection v-if="applied.length" title="Applied">
          <ul class="stack gap-1 text-s" data-variant="plain">
            <li v-for="change in applied" :key="change.key" class="cluster gap-2">
              <span class="font-mono break-words">{{ change.key }}</span>
              <span class="text-muted"
                >{{ OPS[change.op] }} · {{ formatTime(change.appliedAt!) }}</span
              >
            </li>
          </ul>
        </AppSection>
        <EmptyState v-if="!data.changeset.changes.length && !editing"
          >No changes yet. Change a key here, or let an assistant write into it over
          MCP.</EmptyState
        >
      </template>
    </template>
    <template v-if="data" #danger>
      <span>Deletes the changeset and the changes waiting in it; what it applied stays.</span>
      <DangerAction
        label="Delete changeset"
        :title="`Delete ${name}?`"
        :pending="deleting"
        @confirm="remove"
      >
        This cannot be undone.
      </DangerAction>
      <AppAlert v-if="deleteError" title="Could not delete the changeset.">{{
        deleteError
      }}</AppAlert>
    </template>
  </ChangesetList>
</template>
