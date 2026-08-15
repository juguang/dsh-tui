/**
 * dsh-tui UI layer: a differential-rendered terminal chat interface built on
 * @earendil-works/pi-tui.
 *
 * Layout (main screen, top to bottom):
 *   [header bar]   session id · model · cwd · agent status badge
 *   [transcript]   user messages, assistant markdown, tool cards, dividers
 *   [editor]       framed multi-line input with ❯ prompt + placeholder
 *
 * The transcript is a live Container of pi-tui components; the editor is a
 * {@link HintEditor} — an Editor subclass that carries its prompt inside the
 * frame (Claude-style `❯ `) and shows a placeholder while empty.
 *
 * @module dsh-tui/ui
 */

import {
  Container,
  CURSOR_MARKER,
  Editor,
  Markdown,
  ProcessTerminal,
  Text,
  TuiMainScreen,
  matchesKey,
  stripTerminalSequences,
  visibleWidth,
} from '@earendil-works/pi-tui'

import { editorTheme, palette, paint } from './theme.js'

const C_RESET = '\x1b[0m'
const EDITOR_FRAME_GLYPH = '─'

/** Markdown theme wired to the dsh-tui palette. */
const mdTheme = {
  heading: (t) => paint(palette.mdHeading, t),
  link: (t) => paint(palette.mdCode, t),
  linkUrl: (t) => paint(palette.mdCode, t),
  code: (t) => paint(palette.mdCode, t),
  codeBlock: (t) => paint(palette.mdCodeBlock, t),
  codeBlockBorder: (t) => paint(palette.mdCodeBlock, t),
  quote: (t) => paint(palette.mdQuote, t),
  quoteBorder: (t) => paint(palette.mdQuote, t),
  hr: (t) => paint(palette.mdHr, t),
  listBullet: (t) => paint(palette.mdList, t),
  bold: (t) => `${palette.mdBold}${t}${C_RESET}`,
  italic: (t) => `${palette.mdItalic}${t}${C_RESET}`,
  strikethrough: (t) => t,
  underline: (t) => t,
}

/**
 * Editor that carries its prompt inside the frame and shows a placeholder
 * while empty, without making it editable content.
 *
 * Two pi-tui render facts are load-bearing (pinned by the third-party TUI's
 * tests): `Editor.render(width)` returns `[top frame, ...content rows, bottom
 * frame, ...autocomplete rows]` (row 0 is a rule, first content row is row 1);
 * every content row opens with `paddingX` spaces, so with `paddingX >= 1` a
 * row whose first visible column is `─` can only be a frame row.
 */
class HintEditor extends Editor {
  /** Placeholder shown in the empty input row; `undefined` hides it. */
  hint

  /** Prompt rendered at the start of the first content row (`❯ `), ANSI allowed. */
  promptPrefix = ''

  /** Mirror of submitted prompts, newest first (for display; history itself is pi-tui's). */
  entries = []

  /**
   * Record a submitted prompt, in pi-tui's history and in the mirror.
   * @param text - the submitted prompt.
   */
  addToHistory(text) {
    super.addToHistory(text)
    const trimmed = text.trim()
    if (trimmed === '' || this.entries[0] === trimmed) return
    this.entries.unshift(trimmed)
    if (this.entries.length > 200) this.entries.pop()
  }

  /** Read the mirror (newest first). */
  historyEntries() {
    return this.entries
  }

  /**
   * Render the frame, extending it to the full width around the prompt.
   * @param width - full render width.
   * @returns rendered rows.
   */
  render(width) {
    const prefixWidth = visibleWidth(this.promptPrefix)
    const padding = this.getPaddingX()
    let absorbed = stripTerminalSequences(this.promptPrefix).endsWith(' ') ? Math.min(1, padding) : 0
    let inner = width - prefixWidth + absorbed
    if (absorbed > 0 && Math.floor(Math.max(0, inner - 1) / 2) < padding) {
      absorbed = 0
      inner = width - prefixWidth
    }
    if (prefixWidth === 0 || inner < 1) return this.renderFrame(width)
    const lines = this.renderFrame(inner)
    const indent = ' '.repeat(prefixWidth - absorbed)
    const fill = this.borderColor(EDITOR_FRAME_GLYPH.repeat(prefixWidth - absorbed))
    return lines.map((line, index) => {
      if (index === 0 || stripTerminalSequences(line).startsWith(EDITOR_FRAME_GLYPH)) {
        return `${line}${fill}`
      }
      return index === 1 ? `${this.promptPrefix}${line.slice(absorbed)}` : `${indent}${line}`
    })
  }

  /**
   * Render the editor frame, replacing the sole content row with the
   * placeholder while the input is empty.
   * @param width - columns the frame occupies, prompt already deducted.
   * @returns rendered rows, prompt not yet applied.
   */
  renderFrame(width) {
    const lines = super.render(width)
    if (this.hint === undefined || this.getText() !== '') return lines
    const padding = ' '.repeat(this.getPaddingX())
    const marker = this.focused ? CURSOR_MARKER : ''
    const available = Math.max(0, width - visibleWidth(padding))
    const hint = visibleWidth(this.hint) > available
      ? `${this.hint.slice(0, Math.max(0, available - 1))}…`
      : this.hint
    // Row 1 is the sole content row; replace its text with the placeholder.
    const contentRow = lines.findIndex((line, index) => index > 0
      && !stripTerminalSequences(line).startsWith(EDITOR_FRAME_GLYPH))
    if (contentRow === -1) return lines
    const rest = lines.slice(contentRow + 1)
    return [
      ...lines.slice(0, contentRow),
      `${padding}${this.borderColor(hint)}${marker}`,
      ...rest,
    ]
  }
}

/**
 * The chat screen: header + transcript + editor, with helper methods the
 * runner calls as session events arrive.
 */
export class ChatUI {
  /**
   * @param opts - identity and callbacks.
   * @param opts.sessionLabel - short session label for the header.
   * @param opts.model - provider/model shown in the header.
   * @param opts.cwd - working directory shown in the header.
   * @param opts.onSubmit - called with the submitted text (may be async).
   * @param opts.onInterrupt - called on Ctrl+C while running (cancel turn).
   * @param opts.onExit - called on second Ctrl+C while idle.
   */
  constructor(opts) {
    this.opts = opts
    this.terminal = new ProcessTerminal()
    this.tui = new TuiMainScreen(this.terminal)

    // Header: one line, dim identity + status badge.
    this.header = new Text('', 1, 0)
    this.renderHeader('idle')

    // Transcript: a live container we append message components to.
    this.transcript = new Container()

    // Editor: framed multi-line input with ❯ prompt + placeholder.
    this.editor = new HintEditor(this.tui, editorTheme(true), { paddingX: 1 })
    this.editor.promptPrefix = paint(palette.editorPrompt, '❯ ')
    this.editor.hint = paint(palette.editorPlaceholder, '输入消息，Enter 发送，/help 查看命令')
    this.editor.onSubmit = (text) => {
      if (text.trim() === '') return
      this.editor.setText('')
      void this.opts.onSubmit(text)
    }

    this.tui.addChild(this.header)
    this.tui.addChild(this.transcript)
    this.tui.addChild(this.editor)
    this.tui.setFocus(this.editor)

    // Ctrl+C ladder: running -> cancel; idle -> arm exit (second press exits).
    let exitArmed = false
    this.tui.addInputListener((data) => {
      if (!matchesKey(data, 'ctrl+c')) return
      if (this.status === 'running') {
        this.opts.onInterrupt?.()
      } else if (exitArmed) {
        this.opts.onExit?.()
      } else {
        exitArmed = true
        this.flashStatus('press Ctrl+C again to exit')
        setTimeout(() => { exitArmed = false }, 2000)
      }
    })
    this.tui.start()
  }

  /** Last-known agent status, drives the header badge. */
  status = 'idle'

  /** Pending transient status flash, rendered with the header. */
  flash

  /**
   * Render the header bar for the current status.
   * @param status - 'idle' | 'running' | 'error'.
   */
  renderHeader(status) {
    this.status = status
    const { sessionLabel, model, cwd } = this.opts
    const badge = status === 'running'
      ? paint(palette.statusWarn, '● running')
      : status === 'error'
        ? paint(palette.statusErr, '● error')
        : paint(palette.statusOk, '● idle')
    const flash = this.flash ?? ''
    const text = [
      paint(palette.headerText, sessionLabel),
      paint(palette.headerDim, ' · '),
      paint(palette.headerDim, model),
      paint(palette.headerDim, ' · '),
      paint(palette.headerDim, cwd),
      '  ',
      badge,
      flash,
    ].join('')
    this.header.setText(text)
    this.tui.requestRender()
  }

  /** Transient status flash appended to the header (auto-clears). */
  flashStatus(message) {
    this.flash = paint(palette.statusDim, `  ${message}`)
    this.renderHeader(this.status)
    setTimeout(() => {
      this.flash = undefined
      this.renderHeader(this.status)
    }, 2000)
  }

  /**
   * Append a user message to the transcript (Claude-Code style: `❯` prefix).
   * @param text - the user's submitted text.
   */
  appendUser(text) {
    this.transcript.addChild(new Text(
      `${paint(palette.userTag, '❯')}  ${paint(palette.userText, text)}`,
      1, 0,
    ))
    this.transcript.addChild(new Text('', 0, 0))
    this.tui.requestRender()
  }

  /**
   * Append a streaming assistant message. Returns a chainable handle whose
   * `update(text)` receives text deltas and re-renders the markdown body.
   * @returns {{ update(text): handle, finish(): handle }} the streaming handle.
   */
  appendAssistant() {
    let buffer = ''
    const tag = paint(palette.assistantTag, '⏺')
    const body = new Text('', 3, 0)
    const msg = new Container()
    msg.addChild(new Text(`${tag}`, 1, 0))
    msg.addChild(body)
    this.transcript.addChild(msg)
    this.tui.requestRender()
    const self = this
    const handle = {
      update(text) {
        buffer += text
        const rendered = new Markdown(buffer, 3, 0, mdTheme, {
          color: (t) => t,
        }).render(120)
        body.setText(rendered.join('\n'))
        self.tui.requestRender()
        return handle
      },
      finish() {
        self.tui.requestRender()
        return handle
      },
    }
    return handle
  }

  /**
   * Append a "thinking" indicator while the model reasons (dim, Claude-style
   * `⏺ Thinking…`). Returns a handle whose `finish` replaces it with the
   * elapsed duration.
   * @returns {{ finish(): void }} the indicator handle.
   */
  appendThinking() {
    const line = new Text(`${paint(palette.reasoning, '⏺ Thinking…')}`, 1, 0)
    this.transcript.addChild(line)
    const started = Date.now()
    this.tui.requestRender()
    const self = this
    return {
      finish() {
        const seconds = Math.max(1, Math.round((Date.now() - started) / 1000))
        line.setText(`${paint(palette.reasoning, `⏺ Thought for ${seconds}s`)}`)
        self.tui.requestRender()
      },
    }
  }

  /**
   * Append a tool-call card (Claude-Code style: `✻` prefix), one line with
   * the tool name, then the result.
   * @param name - tool name.
   * @param args - raw arguments JSON.
   * @returns a handle whose `result` method sets the outcome line.
   */
  appendTool(name, args) {
    const msg = new Container()
    msg.addChild(new Text(
      paint(palette.toolName, `✻ ${name}(${args})`),
      2, 0,
    ))
    this.transcript.addChild(msg)
    this.tui.requestRender()
    const self = this
    return {
      result(ok) {
        msg.addChild(new Text(
          ok
            ? paint(palette.toolOk, '  ✔ ok')
            : paint(palette.toolErr, '  ✖ error'),
          3, 0,
        ))
        self.tui.requestRender()
      },
    }
  }

  /**
   * Render the agent's todo list (Claude-Code style: `◼`/`✔`/`○` markers and
   * a summary line). The todo/write event is a whole-list snapshot, so this
   * REPLACES the previous todo block.
   * @param todos - the current TodoItem list from the session event.
   */
  setTodo(todos) {
    // Replace the previous todo block (keep one slot per snapshot).
    if (this.todoBlock !== undefined) {
      this.transcript.removeChild(this.todoBlock)
    }
    const block = new Container()
    const summary = {
      completed: 0,
      inProgress: 0,
      pending: 0,
    }
    for (const item of todos) {
      if (item.status === 'completed') summary.completed += 1
      else if (item.status === 'in_progress') summary.inProgress += 1
      else summary.pending += 1
    }
    const count = todos.length
    const open = summary.inProgress + summary.pending
    block.addChild(new Text(
      paint(palette.toolBody, `${count} tasks (${summary.completed} done, ${summary.inProgress} in progress, ${open} open)`),
      2, 0,
    ))
    for (const item of todos) {
      const marker = item.status === 'completed'
        ? paint(palette.toolOk, '✔')
        : item.status === 'in_progress'
          ? paint(palette.statusWarn, '◼')
          : paint(palette.toolBody, '○')
      const text = item.status === 'completed'
        ? paint(palette.toolBody, item.content)
        : item.content
      block.addChild(new Text(`  ${marker}  ${text}`, 3, 0))
    }
    this.transcript.addChild(block)
    this.todoBlock = block
    this.tui.requestRender()
  }

  /** Append a divider line to the transcript. */
  divider() {
    this.transcript.addChild(new Text(paint(palette.divider, '─'.repeat(40)), 1, 0))
    this.tui.requestRender()
  }

  /** Focus the editor (e.g. after a turn completes). */
  focusEditor() {
    this.tui.setFocus(this.editor)
    this.tui.requestRender()
  }

  /** Stop the TUI and restore the terminal. */
  stop() {
    this.tui.stop()
  }
}
