/**
 * Terminal approval answerer: listens to the `approval/request` waterfall for
 * this agent and prompts inside the chat screen. Returns `'allowed-once'` on
 * y/yes, `'rejected'` otherwise (fail closed).
 *
 * Interaction model with the pi-tui chat UI: when an approval is requested,
 * we append a "pending approval" card to the transcript and hand the editor
 * to the approval flow — the next submitted line is the y/n answer, after
 * which the editor returns to normal input.
 *
 * @module dsh-tui/approval
 */

/**
 * Register the terminal approval answerer for one agent.
 * @param ctx - settled application context.
 * @param agent - the agent whose tool calls we answer for.
 * @param ui - the ChatUI instance (transcript + editor).
 * @returns the exact disposer for the event listener.
 */
export function installApprovalAnswerer(ctx, agent, ui) {
  return ctx.on('approval/request', (req, next) => {
    // Answer only for the agent this TUI drives; delegate everything else.
    if (req.agent !== agent) return next()

    const signal = req.signal
    if (signal?.aborted) return 'cancelled'

    return new Promise((resolve) => {
      const card = ui.appendAssistant()
      card.update(
        `⚑ **需要批准** — 工具 \`${req.toolName}\`${req.reason !== undefined ? `\n\n${req.reason}` : ''}\n\n在下方输入 \`y\` 允许（本次），\`n\` 拒绝。`,
      )

      const onAbort = () => {
        finish('cancelled')
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      // Take over the editor for the y/n answer.
      const originalSubmit = ui.editor.onSubmit
      ui.editor.onSubmit = (text) => {
        ui.editor.onSubmit = originalSubmit
        ui.editor.setText('')
        const a = text.trim().toLowerCase()
        finish(a === 'y' || a === 'yes' ? 'allowed-once' : 'rejected')
      }
      ui.focusEditor()

      function finish(outcome) {
        signal?.removeEventListener('abort', onAbort)
        card.finish()
        ui.appendAssistant().update(
          outcome === 'allowed-once' ? '**已批准** ✓' : outcome === 'cancelled' ? '**已取消**' : '**已拒绝** ✗',
        ).finish()
        resolve(outcome)
      }
    })
  })
}
