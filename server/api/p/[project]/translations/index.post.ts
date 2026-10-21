import { announceChange } from '#nexitas/server/utils/changes'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { requestProject } from '#nexitas/server/utils/projects'
import { createSpace } from '../../../../core/translations'

/** Starts translations for the project: a read token, and English as the source. */
export default defineEventHandler((event) => {
  const project = requestProject(event)
  if (!createSpace(nexitasDatabase(), project.id))
    throw createError({ statusCode: 409, statusMessage: 'This project has translations already.' })
  announceChange()
  setResponseStatus(event, 201)
  return { projectId: project.id }
})
