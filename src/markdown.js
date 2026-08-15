/**
 * Minimal markdown → ANSI renderer for the TUI. Deliberately tiny and
 * streaming-friendly: it renders text-delta chunks incrementally, applying
 * inline styling (**bold**, *italic*, `code`) and block styling (headings,
 * fenced code blocks, lists, blockquotes) as complete lines arrive.
 *
 * Trade-offs vs a full markdown library (marked + saxes + …):
 * - No HTML passthrough, no tables, no images.
 * - Inline code spanning chunk boundaries is styled once the closing backtick
 *   lands; until then it prints raw.
 *
 * @module dsh-tui/markdown
 */

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

/** Style one inline text run: **bold**, *italic*, `code`. */
function inline(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, `${C.bold}$1${C.reset}`)
    .replace(/\*([^*]+)\*/g, `${C.italic}$1${C.reset}`)
    .replace(/`([^`]+)`/g, `${C.cyan}$1${C.reset}`)
}

/** Render one complete line with its block context. */
function renderLine(line, state) {
  // Inside a fenced code block: no inline styling, dim color.
  if (state.inCodeBlock) {
    if (/^```/.test(line.trimStart())) {
      state.inCodeBlock = false
      return ''
    }
    return `${C.dim}${line}${C.reset}\n`
  }
  if (/^```/.test(line.trimStart())) {
    state.inCodeBlock = true
    return `${C.dim}${line.trim()}${C.reset}\n`
  }
  const trimmed = line.trim()
  // ATX headings.
  const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
  if (heading) {
    const level = heading[1].length
    const color = level === 1 ? C.bold + C.green : level <= 3 ? C.bold : C.cyan
    return `${color}${inline(heading[2])}${C.reset}\n`
  }
  // Blockquote.
  if (trimmed.startsWith('>')) {
    return `${C.dim}│ ${inline(trimmed.slice(1).trim())}${C.reset}\n`
  }
  // Unordered list items.
  if (/^[-*+]\s+/.test(trimmed)) {
    return ` ${C.green}•${C.reset} ${inline(trimmed.replace(/^[-*+]\s+/, ''))}\n`
  }
  // Ordered list items.
  const ordered = /^\d+\.\s+(.*)$/.exec(trimmed)
  if (ordered) {
    return ` ${C.cyan}${ordered[0].match(/^\d+/)[0]}${C.reset} ${inline(ordered[1])}\n`
  }
  // Horizontal rule.
  if (/^([-*_])\1{2,}$/.test(trimmed)) {
    return `${C.dim}${'─'.repeat(40)}${C.reset}\n`
  }
  return `${inline(line)}\n`
}

/**
 * Streaming markdown renderer. Feed text deltas with {@link push}; block-level
 * styling only applies at complete lines, so partial lines buffer until a
 * newline arrives (or {@link flush} is called at message end).
 */
export class MarkdownRenderer {
  /** Buffered partial line awaiting its newline. */
  buffer = ''
  inCodeBlock = false

  /**
   * Consume one text delta, writing styled output for complete lines and
   * buffering the trailing partial line.
   * @param text - the incoming delta text.
   */
  push(text) {
    this.buffer += text
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      process.stdout.write(renderLine(line, this))
    }
  }

  /** Flush the trailing partial line at message end. */
  flush() {
    if (this.buffer.length > 0) {
      process.stdout.write(renderLine(this.buffer, this))
      this.buffer = ''
    }
    this.inCodeBlock = false
  }
}
