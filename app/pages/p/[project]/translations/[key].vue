<script setup lang="ts">
import { errorMessage } from '#nexitas/app/lib/format'
import type { TextKey } from '../../../../../shared/contracts'
import { longDate } from '../../../../lib/translations'

// One key: its texts in every language, and deleting it.
const route = useRoute()
const project = useProject().id.value
const name = route.params.key as string
useHead({ title: `${name} · ${useRuntimeConfig().public.nexitas.name}` })
const base = `/api/p/${project}/translations/keys/${name}`
const { data, error, refresh } = await useFetch<{ locales: string[]; key: TextKey }>(base)

const savedNotice = ref(false)
async function saved() {
  await refresh()
  savedNotice.value = true
}

const deleteOpen = ref(false)
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
  <div class="stack gap-5">
    <nav aria-label="Breadcrumb">
      <ol class="breadcrumb">
        <li><NuxtLink :to="`/p/${project}/translations`">Translations</NuxtLink></li>
        <li aria-current="page" class="font-mono">{{ name }}</li>
      </ol>
    </nav>

    <div v-if="error" class="alert" data-tone="danger" role="alert">
      <div><strong>Could not load this key.</strong> {{ errorMessage(error) }}</div>
    </div>
    <template v-else-if="data">
      <div class="page-header">
        <div class="stack gap-1 min-w-0">
          <h1 class="text-xl weight-600 font-mono break-words">{{ data.key.key }}</h1>
          <p class="text-s text-muted">Saved {{ longDate(data.key.updatedAt) }}</p>
        </div>
        <button
          type="button"
          class="btn"
          data-size="s"
          data-variant="ghost"
          data-tone="danger"
          @click="deleteOpen = true"
        >
          Delete key
        </button>
      </div>
      <div v-if="deleteError" class="alert" data-tone="danger" role="alert">
        <div><strong>Could not delete the key.</strong> {{ deleteError }}</div>
      </div>
      <div v-if="savedNotice" class="alert" data-tone="success" role="status">
        <div><strong>Saved.</strong> Sites get it with the next publish.</div>
      </div>
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

    <ConfirmDialog
      v-model:open="deleteOpen"
      :title="`Delete ${name}?`"
      confirm-label="Delete key"
      tone="danger"
      @confirm="remove"
    >
      <template #description
        >Its texts in every language go with it. Sites keep it until the next publish.</template
      >
    </ConfirmDialog>
  </div>
</template>
