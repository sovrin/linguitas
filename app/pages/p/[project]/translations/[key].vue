<script setup lang="ts">
import { errorMessage, formatTime } from '#nexitas/app/lib/format'
import type { TextKey } from '../../../../../shared/contracts'

// One key: its texts in every language, and deleting it.
const route = useRoute()
const project = useProject().id.value
const name = route.params.key as string
const base = `/api/p/${project}/translations/keys/${name}`
// Not live: a refresh after a change elsewhere would rebuild the form (keyed by updatedAt) and lose
// what is typed.
const { data, error, refresh } = await useProjectFetch<{ locales: string[]; key: TextKey }>(
  `/translations/keys/${name}`,
  { live: false },
)

const savedNotice = ref(false)
async function saved() {
  await refresh()
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
  <AppPage :title="name" mono failed="Could not load this key." :error="error">
    <template v-if="data" #subtitle>Saved {{ formatTime(data.key.updatedAt) }}</template>
    <template v-if="data" #actions>
      <DangerAction label="Delete key" :title="`Delete ${name}?`" @confirm="remove">
        Its texts in every language go with it. Sites keep it until the next publish.
      </DangerAction>
    </template>
    <template v-if="data">
      <AppAlert v-if="deleteError" title="Could not delete the key.">{{ deleteError }}</AppAlert>
      <AppAlert v-if="savedNotice" tone="success" title="Saved."
        >Sites get it with the next publish.</AppAlert
      >
      <div class="measure">
        <KeyForm
          :key="data.key.updatedAt"
          :project-id="project"
          :locales="data.locales"
          :text-key="data.key"
          @saved="saved"
        />
      </div>
    </template>
  </AppPage>
</template>
