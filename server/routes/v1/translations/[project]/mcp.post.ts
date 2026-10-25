import { requireBearer } from '#nexitas/server/utils/auth'
import { announceChange } from '#nexitas/server/utils/changes'
import { nexitasDatabase } from '#nexitas/server/utils/nexitas'
import { getSpace } from '../../../../core/translations'
import { instructions, translationTools } from '../../../../core/tools'
import { answerMcp } from '../../../../utils/mcp'

/** The project's texts for an assistant, over MCP, with the project's MCP token. An unknown
 *  project, MCP switched off and a wrong token look the same. */
export default defineEventHandler((event) => {
  const db = nexitasDatabase()
  const id = getRouterParam(event, 'project') ?? ''
  requireBearer(event, getSpace(db, id)?.mcpToken ?? undefined)
  return answerMcp(event, {
    name: 'linguitas',
    instructions,
    tools: translationTools(db, id, announceChange),
  })
})
