import type { H3Event } from 'h3'
import { z } from 'zod'

// A Model Context Protocol server over Streamable HTTP, tools only and stateless: every POST is
// one JSON-RPC message answered with JSON, no session and no event stream. Nothing here is
// linguitas': it moves to the core once a second module serves tools.

export interface Tool<Input extends z.ZodType = z.ZodType> {
  name: string
  description: string
  input: Input
  /** What the tool did, as JSON for the model to read. Throw to report a failure. */
  run: (args: z.output<Input>) => unknown
}

/** Lets `tools` keep each its own input type in one list. */
export const tool = <Input extends z.ZodType>(definition: Tool<Input>) => definition as Tool

// The newest first; a client asking for another gets the newest and may hang up.
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

interface Message {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

const reply = (id: Message['id'], result: unknown) => ({ jsonrpc: '2.0', id, result })
const failure = (id: Message['id'], code: number, message: string) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
})

export interface McpServer {
  name: string
  instructions: string
  tools: Tool[]
}

/** Answers one POST to an MCP endpoint. */
export async function answerMcp(event: H3Event, server: McpServer) {
  const answer = answerMessage(await readBody(event).catch(() => undefined), server)
  return answer ?? sendNoContent(event, 202)
}

/** The answer to one JSON-RPC message, or null for one that asks for nothing back. */
export function answerMessage(message: unknown, server: McpServer) {
  if (!message || typeof message !== 'object' || Array.isArray(message))
    return failure(null, -32700, 'Send one JSON-RPC message.')
  const { id, method, params = {} } = message as Message
  // A notification, or a response to us.
  if (id === undefined || !method) return null
  switch (method) {
    case 'initialize': {
      const asked = String(params.protocolVersion ?? '')
      return reply(id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: server.name, version: '1' },
        instructions: server.instructions,
      })
    }
    case 'ping':
      return reply(id, {})
    case 'tools/list':
      return reply(id, {
        tools: server.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: z.toJSONSchema(tool.input, { io: 'input' }),
        })),
      })
    case 'tools/call': {
      const tool = server.tools.find((known) => known.name === params.name)
      if (!tool) return failure(id, -32602, `There is no tool ${String(params.name)}.`)
      const args = tool.input.safeParse(params.arguments ?? {})
      // A tool's failure goes back to the model as its result, so it can correct itself.
      if (!args.success) return reply(id, result(z.prettifyError(args.error), true))
      try {
        return reply(id, result(JSON.stringify(tool.run(args.data), null, 1), false))
      } catch (error) {
        return reply(id, result(error instanceof Error ? error.message : String(error), true))
      }
    }
    default:
      return failure(id, -32601, `${method} is not supported.`)
  }
}

const result = (text: string, isError: boolean) => ({
  content: [{ type: 'text', text }],
  isError,
})
