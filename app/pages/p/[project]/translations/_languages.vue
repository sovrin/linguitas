<script setup lang="ts">
import type { TranslationSpace } from '../../../../../shared/contracts'

// The project's languages, one step at a time: a new one starts as a draft, a live one has to go
// offline before it can be removed, and the source changes on its own. Sites see none of it until
// the next publish.
const project = useProject().id.value
const base = `/api/p/${project}/translations`
const {
  data: space,
  error: loadError,
  refresh,
} = await useProjectFetch<TranslationSpace>('/translations')

const filled = (locale: string) => space.value?.filled[locale] ?? 0
const delivered = (locale: string) => space.value?.delivered.includes(locale) ?? false

const { pending, error, issues, fieldError, submit } = useSubmit()
async function send(path: string, body: object) {
  const done = await submit(async () => {
    await $fetch(`${base}/languages${path}`, { method: 'POST', body })
    await refresh()
    return true
  })
  return !!done
}

const locale = ref('')
async function add() {
  if (await send('', { locale: locale.value.trim() })) locale.value = ''
}

// The steps a site would notice, or that change every translation, are confirmed first.
type Step = 'offline' | 'remove' | 'source'
const step = ref<{ kind: Step; locale: string }>({ kind: 'remove', locale: '' })
const confirmOpen = ref(false)
function ask(kind: Step, locale: string) {
  step.value = { kind, locale }
  confirmOpen.value = true
}
const STEPS: Record<Step, { title: (l: string) => string; label: string; danger?: boolean }> = {
  offline: { title: (l) => `Take ${l} offline?`, label: 'Take offline', danger: true },
  remove: { title: (l) => `Remove ${l}?`, label: 'Remove' },
  source: { title: (l) => `Translate from ${l}?`, label: 'Make it the source' },
}
function confirm() {
  const { kind, locale } = step.value
  if (kind === 'offline') send(`/${locale}`, { live: false })
  else if (kind === 'remove') send(`/${locale}/delete`, {})
  else send(`/${locale}/source`, {})
}
</script>

<template>
  <AppPage title="Languages" failed="Could not load the languages." :error="loadError">
    <template v-if="space">
      <DataTable>
        <thead>
          <tr>
            <th scope="col">Language</th>
            <th scope="col">State</th>
            <th scope="col" data-num>Texts</th>
            <th scope="col"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in space.locales" :key="l">
            <td class="font-mono weight-600">{{ l }}</td>
            <td class="text-s">
              <StateDot
                :tone="space.live.includes(l) ? 'success' : delivered(l) ? 'warning' : undefined"
              >
                <span
                  >{{ l === space.source ? 'Source' : space.live.includes(l) ? 'Live' : 'Draft'
                  }}<span v-if="space.live.includes(l) && !delivered(l)" class="text-muted">
                    · delivered from the next publish</span
                  ><span v-if="!space.live.includes(l) && delivered(l)">
                    · sites get it until the next publish</span
                  ></span
                >
              </StateDot>
            </td>
            <td data-num class="nowrap">{{ filled(l) }} of {{ space.keyCount }}</td>
            <td>
              <span v-if="l !== space.source" class="cluster gap-2 justify-end">
                <template v-if="space.live.includes(l)">
                  <button
                    type="button"
                    class="btn"
                    data-size="s"
                    data-variant="ghost"
                    @click="ask('source', l)"
                  >
                    Make source
                  </button>
                  <button
                    type="button"
                    class="btn"
                    data-size="s"
                    data-variant="ghost"
                    data-tone="danger"
                    @click="ask('offline', l)"
                  >
                    Take offline
                  </button>
                </template>
                <template v-else>
                  <button
                    type="button"
                    class="btn"
                    data-size="s"
                    @click="send(`/${l}`, { live: true })"
                  >
                    Put live
                  </button>
                  <button
                    type="button"
                    class="btn"
                    data-size="s"
                    data-variant="ghost"
                    @click="ask('remove', l)"
                  >
                    Remove
                  </button>
                </template>
              </span>
            </td>
          </tr>
        </tbody>
      </DataTable>
      <FormIssues :error="error" :issues="issues" failed="Could not change the languages." />

      <form class="stack gap-3 measure" @submit.prevent="add">
        <div class="field">
          <label for="locale">Add a language</label>
          <input
            id="locale"
            v-model="locale"
            class="input font-mono text-s"
            data-size="s"
            required
            maxlength="35"
            autocomplete="off"
            spellcheck="false"
            :aria-invalid="!!fieldError('locale') || undefined"
            aria-describedby="locale-help"
          />
          <small id="locale-help"
            >A language tag, such as de, fr or pt-BR. It starts as a draft.</small
          >
          <span v-if="fieldError('locale')" data-error>{{ fieldError('locale') }}</span>
        </div>
        <div class="cluster gap-3 hairline-t pt-5">
          <button
            type="submit"
            class="btn end"
            data-size="s"
            data-variant="primary"
            :disabled="pending"
            :aria-busy="pending || undefined"
          >
            Add language
          </button>
        </div>
      </form>
    </template>

    <ConfirmDialog
      v-model:open="confirmOpen"
      :title="STEPS[step.kind].title(step.locale)"
      :confirm-label="STEPS[step.kind].label"
      :tone="STEPS[step.kind].danger ? 'danger' : undefined"
      @confirm="confirm"
    >
      <template #description>
        <template v-if="step.kind === 'offline'"
          >Sites keep getting it until the next publish; after that, asking for it is a 404. Its
          texts stay, and you can put it live again.</template
        >
        <template v-else-if="step.kind === 'remove'"
          >It leaves this list and the keys' pages. Its texts are kept: add it again and they are
          back.</template
        >
        <template v-else-if="step.kind === 'source'"
          >Every other language is then translated from it. Translations that were up to date stay
          up to date; the rest, the current source included, show as changed.</template
        >
      </template>
    </ConfirmDialog>
  </AppPage>
</template>
