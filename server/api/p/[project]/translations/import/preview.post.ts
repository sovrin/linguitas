import { invalid } from '#nexitas/server/utils/invalid'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { importFilesSchema, readImportFile, type ImportPreview } from '#self/shared/contracts'
import { previewImport } from '#self/server/core/translations'
import { translationSpace } from '#self/server/utils/linguitas'

/** What importing the files would change, row by row; nothing is written yet. */
export default defineEventHandler(async (event): Promise<ImportPreview> => {
  const { project, space } = translationSpace(event)
  const body = importFilesSchema.safeParse(await readBody(event))
  if (!body.success) throw invalid(body.error)
  const skipped: string[] = []
  const files = body.data.files.map(({ name, locale, content }) => {
    const read = readImportFile(content, locale)
    skipped.push(...read.skipped.map((what) => `${name}: ${what}`))
    return { name, entries: read.entries }
  })
  return { ...previewImport(nexitasDatabase(), project.id, space.locales, files), skipped }
})
