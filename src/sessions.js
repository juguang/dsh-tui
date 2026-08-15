/**
 * Session listing for the TUI: newest-first list of persisted/live sessions
 * with their log-backed titles, via the session-query corpus.
 *
 * @module dsh-tui/sessions
 */

/**
 * Render a numbered, selectable list of sessions to stdout.
 * @param ctx - settled application context (must have `sessionQuery` mounted).
 * @returns a map of display index → session id, for the caller to act on.
 */
export async function listSessions(ctx) {
  const query = ctx.get('sessionQuery')
  if (query === undefined) {
    process.stdout.write('(session query not mounted in this composition)\n')
    return new Map()
  }
  const records = await query.listSessions()
  // Newest first (the corpus already returns deterministic newest-first).
  const byId = new Map()
  for (const record of records) {
    byId.set(record.header.id, record.header)
  }
  const ids = [...byId.keys()]
  if (ids.length === 0) {
    process.stdout.write('(no sessions yet)\n')
    return new Map()
  }
  const index = new Map()
  ids.forEach((id, i) => {
    index.set(i + 1, id)
    const header = byId.get(id)
    process.stdout.write(
      `${String(i + 1).padStart(2)}. ${header.cwd ?? '(no cwd)'}  ${id}\n`,
    )
  })
  return index
}

/**
 * Resolve a user's selection input ("3", "/sessions 3") to a session id.
 * @param input - the raw selection text.
 * @param index - the display-index map from {@link listSessions}.
 * @returns the selected session id, or undefined when the selection is invalid.
 */
export function resolveSelection(input, index) {
  const n = Number.parseInt(input, 10)
  if (!Number.isInteger(n) || !index.has(n)) return undefined
  return index.get(n)
}
