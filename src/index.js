/**
 * dsh-tui runner: the interactive terminal UI loop.
 *
 * Flow: wait for the whole tree to settle, create (or resume) an Agent,
 * subscribe to the session event stream for streaming assistant output,
 * then run a readline loop: user input -> agent.followup() -> wait for idle
 * -> prompt again. `/exit` (or Ctrl+C twice) shuts the tree down.
 *
 * Deliberately zero-dependency on the UI side: node:readline + ANSI colors.
 * dsh runtime deps are imported dynamically so the tarball stays installable
 * without a registry round-trip for private rc packages.
 *
 * @module dsh-tui
 */

import { createInterface } from 'node:readline'

const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
const { SessionId } = await import('@deepseek-ai/dsh-session')

/** Stable Cordis plugin name. */
export const name = 'tui-runner'

/** Services required before a session can be created. */
export const inject = ['agents', 'sessions', 'agentDefaultModel']

/** ANSI colors for a minimal terminal skin. */
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
}

/**
 * Apply the TUI: drive one agent/session through an interactive readline loop
 * until the user exits. Blocks the process via the provided exit request.
 * @param ctx - plugin context carrying core services and the launcher exit.
 * @param config - resolved runner config (resume id when provided).
 */
export function apply(ctx, config) {
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('tui-runner: the launcher must provide ctx.appExit before the tree mounts')
  }

  void run(ctx, config, exit).catch((error) => {
    process.stderr.write(`\n${C.red}dsh: ${error instanceof Error ? error.message : String(error)}${C.reset}\n`)
    exit(1)
  })
}

/**
 * Drive one interactive session to quiescence and exit.
 * @param ctx - settled application context.
 * @param config - runner config.
 * @param exit - launcher exit request (disposes the tree first).
 */
async function run(ctx, config, exit) {
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const sessions = ctx.get('sessions')
  const defaultModel = ctx.get('agentDefaultModel')
  if (agents === undefined || sessions === undefined || defaultModel === undefined) return

  const selection = defaultModel.currentSelection()
  let agent
  if (config.resume !== undefined) {
    const { agent: resumed } = await agents.resume({
      resumeSessionId: SessionId(config.resume),
      agentOptions: { provider: selection.provider, model: selection.model },
    })
    agent = resumed
    process.stdout.write(`${C.dim}resumed session ${config.resume}${C.reset}\n`)
  } else {
    const { agent: created } = await agents.create({
      sessionId: SessionId(`session-${crypto.randomUUID()}`),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: selection.provider, model: selection.model },
    })
    agent = created
    process.stdout.write(`${C.dim}new session ${created.session.id}${C.reset}\n`)
  }

  // Streaming renderer: assistant chunks print inline as they arrive.
  const unsubscribe = ctx.on('session/event', (_session, event) => {
    switch (event.type) {
      case 'assistant/chunk':
        switch (event.data.chunk.type) {
          case 'text-delta':
            process.stdout.write(event.data.chunk.text)
            break
          case 'reasoning-delta':
            process.stdout.write(`${C.dim}${event.data.chunk.text}${C.reset}`)
            break
          default:
            break
        }
        break
      case 'assistant/message':
        process.stdout.write('\n')
        break
      case 'tool/call':
        process.stdout.write(`\n${C.yellow}⚙ ${event.data.name}(${event.data.arguments})${C.reset}\n`)
        break
      case 'tool/result':
        process.stdout.write(`${C.dim}  └ ok${C.reset}\n`)
        break
      case 'turn/end':
        if (event.data.reason.kind === 'error') {
          process.stdout.write(`${C.red}✗ ${event.data.reason.error.message}${C.reset}\n`)
        }
        break
      default:
        break
    }
  })
  void unsubscribe

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${C.green}❯${C.reset} `,
  })

  // Ctrl+C: first cancels an in-flight turn, second exits.
  let ctrlCPressed = false
  rl.on('SIGINT', () => {
    if (agent.status === 'running') {
      agent.cancel({ kind: 'user' })
      process.stdout.write(`\n${C.dim}cancelled${C.reset}\n`)
      rl.prompt()
      return
    }
    if (ctrlCPressed) {
      process.stdout.write('\n')
      rl.close()
      exit(0)
      return
    }
    ctrlCPressed = true
    process.stdout.write(`\n${C.dim}press Ctrl+C again to exit${C.reset}\n`)
    rl.prompt()
    setTimeout(() => { ctrlCPressed = false }, 2000)
  })

  rl.on('line', async (line) => {
    const text = line.trim()
    if (text === '') {
      rl.prompt()
      return
    }
    if (text === '/exit' || text === '/quit') {
      rl.close()
      exit(0)
      return
    }
    if (text === '/help') {
      process.stdout.write(`${C.dim}/exit 退出 | Ctrl+C 取消当前回合（连按两次退出）${C.reset}\n`)
      rl.prompt()
      return
    }
    // Hand the input to the agent and wait for the turn to converge.
    rl.pause()
    try {
      agent.followup(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }))
      await agent.whenIdle()
    } catch (error) {
      process.stdout.write(`${C.red}✗ ${error instanceof Error ? error.message : String(error)}${C.reset}\n`)
    } finally {
      // Piped input can close the interface while a turn is still converging.
      if (!rl.closed) {
        rl.resume()
        rl.prompt()
      }
    }
  })

  rl.prompt()
}
