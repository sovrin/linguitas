import { announceChange } from '#nexitas/server/utils/changes'
import { invalid } from '#nexitas/server/utils/invalid'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { mcpAccessSchema } from '#self/shared/contracts'
import { setMcpAccess } from '#self/server/core/translations'
import { translationSpace } from '#self/server/utils/linguitas'

/** Lets assistants edit the texts over MCP with a new token, or stops them. */
export default defineEventHandler(async (event) => {
  const body = mcpAccessSchema.safeParse(await readBody(event))
  if (!body.success) throw invalid(body.error)
  setMcpAccess(nexitasDatabase(), translationSpace(event).project.id, body.data.on)
  announceChange()
  return { ok: true }
})
