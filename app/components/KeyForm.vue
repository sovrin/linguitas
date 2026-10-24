<script setup lang="ts">
import { CHECKS, audit, type TextKey } from '../../shared/contracts'

/** Writes a new key, or edits `textKey`: its note and a text per language, the source first. Each
 *  translation shows what the audit finds as it is typed, as the server will store it. */
const props = defineProps<{
  projectId: string
  locales: string[]
  textKey?: TextKey
  /** A new key's name to start with: one a site's code asks for. */
  name?: string
}>()
const emit = defineEmits<{ saved: [TextKey] }>()

const name = ref(props.textKey?.key ?? props.name ?? '')
const note = ref(props.textKey?.note ?? '')
const source = props.locales[0]!
const texts = reactive<Record<string, string>>(
  Object.fromEntries(
    props.locales.map((locale) => [locale, props.textKey?.texts[locale]?.text ?? '']),
  ),
)
const confirmed = ref<string[]>([])

// The key as saving it would store it: a translation that is changed or confirmed is written for
// the source as it stands; one left alone keeps the source it had.
const draft = computed<TextKey>(() => ({
  key: name.value,
  note: note.value,
  updatedAt: 0,
  texts: Object.fromEntries(
    props.locales
      .filter((locale) => texts[locale])
      .map((locale) => {
        const before = props.textKey?.texts[locale]
        const kept = before && before.text === texts[locale] && !confirmed.value.includes(locale)
        const basedOn = locale === source ? null : kept ? before.basedOn : texts[source]!
        return [locale, { text: texts[locale]!, basedOn, updatedAt: 0 }]
      }),
  ),
}))
const checks = (locale: string) => audit(draft.value, locale, source)
const writtenFor = (locale: string) => props.textKey?.texts[locale]?.basedOn ?? ''
/** A translation left as it was, whose source has changed since: the owner may confirm it fits. */
function canConfirm(locale: string) {
  const before = props.textKey?.texts[locale]
  return (
    locale !== source &&
    !!before &&
    before.text === texts[locale] &&
    before.basedOn !== texts[source]
  )
}

const { pending, error, issues, fieldError, submit } = useSubmit()

async function save() {
  const body = { note: note.value, texts, confirmed: confirmed.value }
  const base = `/api/p/${props.projectId}/translations/keys`
  const saved = await submit(() =>
    $fetch<TextKey>(props.textKey ? `${base}/${props.textKey.key}` : base, {
      method: 'POST',
      body: props.textKey ? body : { ...body, key: name.value },
    }),
  )
  if (saved) emit('saved', saved)
}
</script>

<template>
  <form class="stack gap-5" @submit.prevent="save">
    <fieldset :disabled="pending" class="stack gap-4">
      <div v-if="!textKey" class="field">
        <label for="key">Key</label>
        <input
          id="key"
          v-model="name"
          class="input font-mono text-s"
          data-size="s"
          required
          maxlength="120"
          autocomplete="off"
          spellcheck="false"
          :aria-invalid="!!fieldError('key') || undefined"
          aria-describedby="key-help"
        />
        <small id="key-help"
          >Such as checkout.pay.button · sites look the text up by it, so it cannot change
          later</small
        >
        <span v-if="fieldError('key')" data-error>{{ fieldError('key') }}</span>
      </div>
      <div class="field">
        <label for="note">Note</label>
        <input
          id="note"
          v-model="note"
          class="input"
          data-size="s"
          maxlength="500"
          aria-describedby="note-help"
        />
        <small id="note-help">Where the text appears, or what to keep in mind translating it</small>
      </div>

      <div v-for="locale in locales" :key="locale" class="field">
        <label :for="`text-${locale}`"
          ><span class="font-mono">{{ locale }}</span
          >{{ locale === source ? ' · source' : '' }}</label
        >
        <textarea
          :id="`text-${locale}`"
          v-model="texts[locale]"
          data-size="s"
          class="input"
          rows="2"
          maxlength="10000"
          :aria-describedby="checks(locale).length ? `checks-${locale}` : undefined"
        ></textarea>
        <span v-if="checks(locale).length" :id="`checks-${locale}`" class="cluster gap-2">
          <StateDot
            v-for="check in checks(locale)"
            :key="check"
            class="text-s"
            :tone="check === 'unchanged' ? undefined : 'warning'"
            >{{ CHECKS[check] }}</StateDot
          >
          <small v-if="canConfirm(locale) && writtenFor(locale)" class="break-words"
            >Written for “{{ writtenFor(locale) }}”</small
          >
        </span>
        <label v-if="canConfirm(locale)"
          ><input v-model="confirmed" type="checkbox" :value="locale" /> Still fits the
          source</label
        >
        <span v-if="fieldError(`texts.${locale}`)" data-error>{{
          fieldError(`texts.${locale}`)
        }}</span>
      </div>
    </fieldset>

    <FormIssues :error="error" :issues="issues" failed="Could not save the key." />

    <div class="cluster gap-3 hairline-t pt-5">
      <p class="caption">An empty text removes it. Sites get changes with the next publish.</p>
      <button
        type="submit"
        class="btn end"
        data-size="s"
        data-variant="primary"
        :disabled="pending"
        :aria-busy="pending || undefined"
      >
        {{ textKey ? 'Save changes' : 'Add key' }}
      </button>
    </div>
  </form>
</template>
