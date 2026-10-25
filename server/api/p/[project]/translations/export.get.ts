import { z } from 'zod'
import { invalid } from '#nexitas/server/utils/invalid'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { localeSchema } from '../../../../../shared/contracts'
import { exportTexts } from '../../../../core/translations'
import { translationSpace } from '../../../../utils/linguitas'

const querySchema = z.object({
  /** Comma-separated; every language when left out. */
  locales: z.string().max(500).optional(),
  prefix: z.string().max(120).optional(),
  needs: localeSchema.optional(),
})

/** The project's keys, notes and texts as a linguitas file, to download: all of it as a backup,
 *  or some languages and keys for a translator. The import takes it back. */
export default defineEventHandler((event) => {
  const { project, space } = translationSpace(event)
  const query = querySchema.safeParse(getQuery(event))
  if (!query.success) throw invalid(query.error)
  const asked = query.data.locales?.split(',').filter(Boolean)
  const locales = asked ? space.locales.filter((locale) => asked.includes(locale)) : space.locales
  if (query.data.needs && !space.locales.includes(query.data.needs))
    throw createError({ statusCode: 404, statusMessage: 'The project has no such language.' })
  setHeader(event, 'Content-Disposition', `attachment; filename="${project.id}-translations.json"`)
  return exportTexts(nexitasDatabase(), project.id, space, { ...query.data, locales })
})
