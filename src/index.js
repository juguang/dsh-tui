/**
 * dsh-tui runner: the interactive terminal UI loop, driven by pi-tui's
 * differential renderer (see ./ui.js).
 *
 * Flow: wait for the whole tree to settle, create (or resume) an Agent,
 * subscribe to the session event stream for streaming assistant output, and
 * render everything into the chat screen. The editor's onSubmit feeds the
 * agent; `/sessions` lists persisted sessions; approval/request prompts
 * inline on the terminal.
 *
 * dsh runtime deps are imported dynamically so the tarball stays installable;
 * pi-tui is a real npm dependency (public registry) imported statically.
 *
 * @module dsh-tui
 */

const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
const { SessionId } = await import('@deepseek-ai/dsh-session')

import { ChatUI } from './ui.js'
import { listSessions } from './sessions.js'
import { installApprovalAnswerer } from './approval.js'

/** Stable Cordis plugin name. */
export const name = 'tui-runner'

/** Services required before a session can be created. */
export const inject = ['agents', 'sessions', 'agentDefaultModel']

/** ANSI colors for the minimal non-UI output (errors before the screen starts). */
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
}

/**
 * Apply the TUI: drive one agent/session through the chat screen until the
 * user exits. Blocks the process via the provided exit request.
 * @param ctx - plugin context carrying core services and the launcher exit.
 * @param config - resolved runner config (resume id / list flag).
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

  // `--list`: print persisted sessions and exit without the chat screen.
  if (config.list === true) {
    const index = await listSessions(ctx)
    if (index.size > 0) {
      process.stdout.write(`${C.dim}resume one with: dsh --profile tui --resume <id>${C.reset}\n`)
    }
    exit(index.size > 0 ? 0 : 1)
    return
  }

  const selection = defaultModel.currentSelection()
  let agent
  if (config.resume !== undefined) {
    const { agent: resumed } = await agents.resume({
      resumeSessionId: SessionId(config.resume),
      agentOptions: { provider: selection.provider, model: selection.model },
    })
    agent = resumed
  } else {
    const { agent: created } = await agents.create({
      sessionId: SessionId(`session-${crypto.randomUUID()}`),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: selection.provider, model: selection.model },
    })
    agent = created
  }

  const sessionLabel = config.resume !== undefined
    ? `resume ${config.resume}`
    : `new ${agent.session.id}`

  const ui = new ChatUI({
    sessionLabel,
    model: `${selection.provider}/${selection.model}`,
    cwd: process.cwd(),
    onSubmit: (text) => handleInput(text),
    onInterrupt: () => {
      agent.cancel({ kind: 'user' })
      ui.renderHeader('idle')
    },
    onExit: () => {
      ui.stop()
      exit(0)
    },
  })

  // Terminal approval: [y/n] prompts for tool calls that require approval.
  // The approval module answers through the chat UI's editor submit path.
  const disposeApproval = installApprovalAnswerer(ctx, agent, ui)
  void disposeApproval

  /** Handle one submitted line: slash commands vs agent input. */
  async function handleInput(text) {
    if (text.startsWith('/')) {
      const [cmd, ...rest] = text.slice(1).split(/\s+/)
      switch (cmd) {
        case 'exit':
        case 'quit':
          ui.stop()
          exit(0)
          return
        case 'help':
          ui.appendAssistant().update(
            '**命令**\n- `/exit` 退出\n- `/sessions` 列出会话\n- 其余输入发给 agent\n\n**快捷键**\n- `Ctrl+C` 取消当前回合（空闲时连按两次退出）',
          ).finish()
          return
        case 'sessions': {
          const index = await listSessions(ctx)
          const arg = rest.join(' ').trim()
          const n = Number.parseInt(arg, 10)
          if (arg !== '' && Number.isInteger(n) && index.has(n)) {
            const id = index.get(n)
            ui.appendAssistant().update(
              `选中会话 \`${id}\`，\`/exit\` 后运行 \`dsh --profile tui --resume ${id}\` 恢复。`,
            ).finish()
          }
          return
        }
        default:
          ui.appendAssistant().update(`未知命令 \`/${cmd}\`，输入 \`/help\` 查看。`).finish()
          return
      }
    }

    // Streaming renderer: attach after the message is created.
    ui.appendUser(text)
    const stream = ui.appendAssistant()
    const detach = ctx.on('session/event', (_session, event) => {
      switch (event.type) {
        case 'assistant/chunk':
          if (event.data.chunk.type === 'text-delta') stream.update(event.data.chunk.text)
          break
        case 'assistant/message':
          stream.finish()
          break
        case 'tool/call':
          ui.appendTool(event.data.name, event.data.arguments)
          break
        default:
          break
      }
    })

    agent.followup(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }))
    try {
      await agent.whenIdle()
    } catch (error) {
      ui.appendAssistant().update(
        `**错误**\n\`\`\`\n${error instanceof Error ? error.message : String(error)}\n\`\`\``,
      ).finish()
    } finally {
      detach()
      ui.focusEditor()
    }
  }

  // Initial greeting with a divider.
  ui.divider()
  ui.appendAssistant().update(
    `**${config.resume !== undefined ? '已恢复' : '新会话'}** 模型 \`${selection.provider}/${selection.model}\`，工作目录 \`${process.cwd()}\`。输入消息开始，\`/help\` 查看命令。`,
  ).finish()
  ui.focusEditor()
}
