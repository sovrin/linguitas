<script setup lang="ts">
import { errorMessage } from '#nexitas/app/lib/format'
import type { TextKey, TranslationSpace } from '../../../../../shared/contracts'

const project = useProject().id.value
useHead({ title: `New key · ${project}` })
// Not live: the page is a form, and its fields should not shift while it is typed in.
const { data: space, error } = await useFetch<TranslationSpace>(`/api/p/${project}/translations`)
const saved = (key: TextKey) => navigateTo(`/p/${project}/translations/${key.key}`)
</script>

<template>
  <div class="stack gap-5">
    <nav aria-label="Breadcrumb">
      <ol class="breadcrumb">
        <li><NuxtLink :to="`/p/${project}/translations`">Translations</NuxtLink></li>
        <li aria-current="page">New key</li>
      </ol>
    </nav>
    <div class="page-header">
      <h1 class="text-xl weight-600">New key</h1>
    </div>
    <div v-if="error" class="alert" data-tone="danger" role="alert">
      <div><strong>Could not load the languages.</strong> {{ errorMessage(error) }}</div>
    </div>
    <!-- A form reads best at a line's length, however wide the window. -->
    <div v-else-if="space" class="measure">
      <KeyForm :project-id="project" :locales="space.locales" @saved="saved" />
    </div>
  </div>
</template>
