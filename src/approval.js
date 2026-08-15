/**
 * Terminal approval answerer: listens to the `approval/request` waterfall for
 * this agent and prompts on the terminal. Returns `'allowed-once'` on y/yes,
 * `'rejected'` otherwise (fail closed).
 *
 * @module dsh-tui/approval
 */

const C = {
  reset: '\x1b[0m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
}

/**
 * Register the terminal approval answerer for one agent.
 * @param ctx - settled application context.
 * @param agent - the agent whose tool calls we answer for.
 * @param rl - the active readline interface (paused while a turn runs).
 * @returns the exact disposer for the event listener.
 */
export function installApprovalAnswerer(ctx, agent, rl) {
  return ctx.on('approval/request', (req, next) => {
    // Answer only for the agent this TUI drives; delegate everything else.
    if (req.agent !== agent) return next()

    const signal = req.signal
    if (signal?.aborted) return 'cancelled'

    return new Promise((resolve) => {
      process.stdout.write(
        `\n${C.yellow}⚑ ${req.toolName}${C.reset}${req.reason !== undefined ? ` — ${req.reason}` : ''}\n`,
      )
      const onAbort = () => {
        resolve('cancelled')
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      // rl.question temporarily takes over the interface; the line handler
      // is paused while a turn runs, so this cannot interleave with it.
      rl.question(`${C.yellow}[y/n] ${C.reset}`, (answer) => {
        signal?.removeEventListener('abort', onAbort)
        const a = answer.trim().toLowerCase()
        process.stdout.write(`${C.dim}${a === 'y' || a === 'yes' ? '→ allowed' : '→ rejected'}${C.reset}\n`)
        resolve(a === 'y' || a === 'yes' ? 'allowed-once' : 'rejected')
      })
    })
  })
}
