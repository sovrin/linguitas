<script setup lang="ts">
import { errorMessage, formatTime } from '#nexitas/app/lib/format'
import type { TextKey } from '../../../../../shared/contracts'
import KeyTree from '../../../../components/KeyTree.vue'

// One key, opened beside the tree it sits in: its texts in every language stacked in the
// inspector, any number of them, and deleting it at the inspector's foot.
const route = useRoute()
const project = useProject().id.value
const name = route.params.key as string
const base = `/api/p/${project}/translations/keys/${name}`
// Not live: a refresh after a change elsewhere would rebuild the form (keyed by updatedAt) and lose
// what is typed.
const { data, error, refresh } = await useProjectFetch<{
  locales: string[]
  key: TextKey
  usedBy: string[] | null
}>(`/translations/keys/${name}`, { live: false })

const savedNotice = ref(false)
async function saved() {
  await Promise.all([refresh(), refreshNuxtData()])
  savedNotice.value = true
}

const deleteError = ref('')
async function remove() {
  deleteError.value = ''
  try {
    await $fetch(`${base}/delete`, { method: 'POST', body: {} })
    await navigateTo(`/p/${project}/translations`)
  } catch (cause) {
    deleteError.value = errorMessage(cause)
  }
}
</script>

<template>
  <KeyTree :selected="name">
    <template #aside>
      <AppAlert v-if="error" title="Could not load this key.">{{ errorMessage(error) }}</AppAlert>
      <template v-else-if="data">
        <div class="stack gap-1">
          <p class="font-mono weight-600 break-words">{{ name }}</p>
          <p class="text-s text-muted">Saved {{ formatTime(data.key.updatedAt) }}</p>
          <!-- What the sites' builds reported; nothing until one has. -->
          <p v-if="data.usedBy?.length" class="text-s text-muted">
            Used by <span class="font-mono">{{ data.usedBy.join(', ') }}</span>
          </p>
          <StateDot v-else-if="data.usedBy" class="text-s">Not in any site's code</StateDot>
        </div>
        <AppAlert v-if="deleteError" title="Could not delete the key.">{{ deleteError }}</AppAlert>
        <AppAlert v-if="savedNotice" tone="success" title="Saved."
          >Sites get it with the next publish.</AppAlert
        >
        <KeyForm
          :key="data.key.updatedAt"
          :project-id="project"
          :locales="data.locales"
          :text-key="data.key"
          @saved="saved"
        />
      </template>
    </template>
    <template v-if="data" #danger>
      <span>Removes the key and its texts in every language.</span>
      <DangerAction label="Delete key" :title="`Delete ${name}?`" @confirm="remove">
        Its texts in every language go with it. Sites keep it until the next publish.
      </DangerAction>
    </template>
  </KeyTree>
</template>
