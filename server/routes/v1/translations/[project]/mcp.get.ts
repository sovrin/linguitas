/** MCP clients may ask for an event stream here; this server answers every call at once. */
export default defineEventHandler((event) => {
  setHeader(event, 'Allow', 'POST')
  throw createError({ statusCode: 405, statusMessage: 'Send MCP messages as POST.' })
})
