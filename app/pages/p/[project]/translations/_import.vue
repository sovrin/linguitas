<script setup lang="ts">
import { plural } from '#nexitas/app/lib/format'
import {
  localeOfFileName,
  type ImportPreview,
  type TranslationSpace,
} from '../../../../../shared/contracts'

// Files into the project, in two steps: read them and see what would change, row by row, then
// write only what was picked. A linguitas file (Export) brings every language and each key's
// note; any other JSON is one language's texts, flat or nested, as i18n libraries keep them.
const project = useProject().id.value
const base = `/api/p/${project}/translations`
const { data: space, error: loadError } = await useProjectFetch<TranslationSpace>('/translations', {
  live: false,
})

interface Source {
  name: string
  content: Record<string, unknown> | null
  /** A linguitas file names its own languages. */
  whole: boolean
  locale: string
  problem?: string
}
const sources = ref<Source[]>([])
const pasted = ref('')
const pastedLocale = ref(space.value?.source ?? '')

function read(name: string, text: string): Source {
  const source: Source = {
    name,
    content: null,
    whole: false,
    locale: localeOfFileName(name) ?? space.value?.source ?? '',
  }
  try {
    const json = JSON.parse(text)
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('not an object')
    source.content = json
    source.whole = json.linguitas === 1
  } catch {
    source.problem = 'This is not a JSON object.'
  }
  return source
}

async function pick(event: Event) {
  const input = event.target as HTMLInputElement
  for (const file of input.files ?? []) sources.value.push(read(file.name, await file.text()))
  input.value = ''
}

const { pending, error, issues, submit } = useSubmit()
const preview = ref<ImportPreview | null>(null)
const result = ref<{ added: number; changed: number } | null>(null)
// Which rows to write. The mode sets them; each can be changed after.
const picked = ref<boolean[]>([])
const overwrite = ref(false)
const createKeys = ref(true)
function pickByMode() {
  picked.value = (preview.value?.rows ?? []).map(
    (row) =>
      (row.change !== 'changed' || overwrite.value) && (row.change !== 'key' || createKeys.value),
  )
}
watch([overwrite, createKeys], pickByMode)
const chosen = computed(() => (preview.value?.rows ?? []).filter((_, index) => picked.value[index]))
function pickAll(event: Event) {
  const on = (event.target as HTMLInputElement).checked
  picked.value = (preview.value?.rows ?? []).map(() => on)
}

async function look() {
  result.value = null
  const files = sources.value.filter((source) => source.content)
  if (pasted.value.trim()) {
    const own = read('pasted', pasted.value)
    if (own.problem) {
      issues.value = []
      error.value = `Pasted: ${own.problem}`
      return
    }
    files.push({ ...own, locale: pastedLocale.value })
  }
  if (!files.length) {
    error.value = 'Pick a file or paste one.'
    return
  }
  const answer = await submit(() =>
    $fetch<ImportPreview>(`${base}/import/preview`, {
      method: 'POST',
      body: {
        files: files.map(({ name, content, whole, locale }) => ({
          name,
          content,
          ...(whole ? {} : { locale }),
        })),
      },
    }),
  )
  if (!answer) return
  preview.value = answer
  pickByMode()
}

async function write() {
  const done = await submit(() =>
    $fetch<{ added: number; changed: number }>(`${base}/import`, {
      method: 'POST',
      body: { entries: chosen.value.map(({ key, locale, text }) => ({ key, locale, text })) },
    }),
  )
  if (!done) return
  result.value = done
  preview.value = null
  sources.value = []
  pasted.value = ''
}

// What a row without a current value does.
const CHANGES = { key: 'New key', new: 'Empty', changed: '' } as const
</script>

<template>
  <AppPage title="Import" failed="Could not load the languages." :error="loadError">
    <form v-if="space && !preview" class="stack gap-5 measure" @submit.prevent="look">
      <AppAlert v-if="result" tone="success" title="Imported.">
        {{ plural(result.added, 'key') }} added,
        {{ plural(result.changed, 'note or text', 'notes or texts') }} changed.
        <NuxtLink :to="`/p/${project}/translations`" class="link">See the keys</NuxtLink>
      </AppAlert>
      <fieldset :disabled="pending" class="stack gap-4">
        <div class="field">
          <label for="files">Files</label>
          <input
            id="files"
            type="file"
            accept=".json,application/json"
            multiple
            class="input"
            data-size="s"
            aria-describedby="files-help"
            @change="pick"
          />
          <small id="files-help"
            >A file from Export brings every language and each key's note. Any other is one
            language's texts by key, flat or nested; its name says which (de.json).</small
          >
        </div>
        <ul v-if="sources.length" class="stack gap-2 text-s" data-variant="plain">
          <li v-for="(source, index) in sources" :key="index" class="cluster gap-3">
            <span class="font-mono">{{ source.name }}</span>
            <span v-if="source.problem" data-error>{{ source.problem }}</span>
            <span v-else-if="source.whole" class="text-muted">every language and note</span>
            <span v-else class="select"
              ><select
                v-model="source.locale"
                class="input font-mono"
                data-size="s"
                :aria-label="`Language of ${source.name}`"
              >
                <option v-for="locale in space.locales" :key="locale" :value="locale">
                  {{ locale }}
                </option>
              </select></span
            >
            <button type="button" class="link text-muted end" @click="sources.splice(index, 1)">
              Remove
            </button>
          </li>
        </ul>
        <div class="field">
          <label for="pasted">Or paste one</label>
          <textarea
            id="pasted"
            v-model="pasted"
            class="input font-mono text-s"
            rows="8"
            spellcheck="false"
          ></textarea>
        </div>
        <div v-if="pasted.trim()" class="field">
          <label for="pasted-locale">Its language, unless it is from Export</label>
          <span class="select"
            ><select
              id="pasted-locale"
              v-model="pastedLocale"
              class="input font-mono"
              data-size="s"
            >
              <option v-for="locale in space.locales" :key="locale" :value="locale">
                {{ locale }}
              </option>
            </select></span
          >
        </div>
      </fieldset>
      <FormIssues :error="error" :issues="issues" failed="Could not read the files." />
      <div class="cluster gap-3 hairline-t pt-5">
        <button
          type="submit"
          class="btn end"
          data-size="s"
          data-variant="primary"
          :disabled="pending"
          :aria-busy="pending || undefined"
        >
          Preview
        </button>
      </div>
    </form>

    <form v-else-if="space && preview" class="stack gap-5" @submit.prevent="write">
      <p>
        {{ plural(preview.rows.length, 'change') }} to pick from;
        {{ plural(preview.same, 'text') }} already the same.
      </p>
      <AppAlert v-if="preview.unknownLocales.length" tone="warning" title="Left out.">
        The project has no <span class="font-mono">{{ preview.unknownLocales.join(', ') }}</span
        >. Add them under
        <NuxtLink :to="`/p/${project}/translations/_languages`" class="link">Languages</NuxtLink>
        to import their texts.
      </AppAlert>
      <AppAlert v-if="preview.skipped.length" tone="warning" title="Not read.">
        <span class="font-mono break-words">{{ preview.skipped.join(', ') }}</span>
      </AppAlert>
      <fieldset :disabled="pending" class="cluster gap-5">
        <label
          ><input v-model="overwrite" type="radio" name="mode" :value="false" /> Fill only what is
          empty</label
        >
        <label
          ><input v-model="overwrite" type="radio" name="mode" :value="true" /> Also replace what
          differs</label
        >
        <label><input v-model="createKeys" type="checkbox" /> Create keys the project lacks</label>
      </fieldset>
      <DataTable v-if="preview.rows.length" label="Changes">
        <thead>
          <tr>
            <th scope="col">
              <input
                type="checkbox"
                :checked="chosen.length === preview.rows.length"
                :indeterminate="chosen.length > 0 && chosen.length < preview.rows.length"
                aria-label="All changes"
                @change="pickAll"
              />
            </th>
            <th scope="col">Key</th>
            <th scope="col">Language</th>
            <th scope="col">Now</th>
            <th scope="col">Imported</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in preview.rows" :key="`${row.key} ${row.locale}`">
            <td>
              <input
                v-model="picked[index]"
                type="checkbox"
                :aria-label="`${row.key}, ${row.locale ?? 'note'}`"
              />
            </td>
            <td class="font-mono">{{ row.key }}</td>
            <td :class="row.locale ? 'font-mono' : 'text-muted'">{{ row.locale ?? 'note' }}</td>
            <td class="text-muted break-words">{{ row.before ?? CHANGES[row.change] }}</td>
            <td class="break-words">{{ row.text }}</td>
          </tr>
        </tbody>
      </DataTable>
      <EmptyState v-else>Nothing to change: the project says all of it already.</EmptyState>
      <FormIssues :error="error" :issues="issues" failed="Could not import." />
      <div class="cluster gap-3 hairline-t pt-5">
        <button type="button" class="btn" data-size="s" :disabled="pending" @click="preview = null">
          Back
        </button>
        <button
          type="submit"
          class="btn end"
          data-size="s"
          data-variant="primary"
          :disabled="pending || !chosen.length"
          :aria-busy="pending || undefined"
        >
          Import {{ plural(chosen.length, 'change') }}
        </button>
      </div>
    </form>
  </AppPage>
</template>
