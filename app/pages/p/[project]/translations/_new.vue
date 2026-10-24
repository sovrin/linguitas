<script setup lang="ts">
import type { TextKey, TranslationSpace } from '../../../../../shared/contracts'

const project = useProject().id.value
// Not live: the page is a form, and its fields should not shift while it is typed in.
const { data: space, error } = await useProjectFetch<TranslationSpace>('/translations', {
  live: false,
})
// "Create key" beside a key a site asks for brings its name.
const asked = useRoute().query.key
const saved = (key: TextKey) => navigateTo(`/p/${project}/translations/${key.key}`)
</script>

<template>
  <AppPage title="New key" failed="Could not load the languages." :error="error">
    <!-- A form reads best at a line's length, however wide the window. -->
    <div v-if="space" class="measure">
      <KeyForm
        :project-id="project"
        :locales="space.locales"
        :name="typeof asked === 'string' ? asked : undefined"
        @saved="saved"
      />
    </div>
  </AppPage>
</template>
