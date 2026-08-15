/**
 * dsh-tui theme: a cohesive palette for the differential-rendered UI.
 *
 * Layered by role so the screen reads at a glance:
 * - header: session identity (dim cyan, right-aligned model badge)
 * - transcript: user (green "you" tag), assistant (default with styled
 *   markdown), tool cards (yellow border, dim body)
 * - editor: bordered input with a `❯` prompt, placeholder when empty
 *
 * @module dsh-tui/theme
 */

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  brightBlack: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',
  // Backgrounds.
  bgBlack: '\x1b[40m',
  bgBrightBlack: '\x1b[100m',
  bgBlue: '\x1b[44m',
  bgBrightBlue: '\x1b[104m',
}

/** Paint a string in one foreground color. */
const paint = (color, text) => `${color}${text}${C.reset}`

/** One complete palette. Components pick roles from here. */
export const palette = {
  /** Session header bar. */
  headerBg: C.bgBrightBlack,
  headerText: C.brightWhite,
  headerDim: C.brightBlack,

  /** Transcript roles. */
  userTag: C.green,
  userText: C.white,
  assistantTag: C.cyan,
  reasoning: C.brightBlack,
  divider: C.brightBlack,
  toolName: C.brightYellow,
  toolBody: C.brightBlack,
  toolOk: C.brightGreen,
  toolErr: C.brightRed,

  /** Markdown roles (consumed by the markdown renderer). */
  mdHeading: C.bold + C.brightCyan,
  mdBold: C.bold,
  mdItalic: C.dim,
  mdCode: C.brightMagenta,
  mdCodeBlock: C.brightBlack,
  mdList: C.brightGreen,
  mdQuote: C.brightBlack,
  mdHr: C.brightBlack,

  /** Editor. */
  editorBorder: C.brightBlack,
  editorBorderFocus: C.brightCyan,
  editorPrompt: C.brightGreen,
  editorPlaceholder: C.brightBlack,
  editorText: C.white,

  /** Status line. */
  statusOk: C.brightGreen,
  statusWarn: C.brightYellow,
  statusErr: C.brightRed,
  statusDim: C.brightBlack,
}

/**
 * The Editor theme object pi-tui's Editor expects: a borderColor function and
 * a SelectListTheme for autocomplete.
 * @param focused - whether the editor currently holds focus.
 * @returns the EditorTheme.
 */
export function editorTheme(focused = true) {
  return {
    borderColor: (str) => paint(focused ? palette.editorBorderFocus : palette.editorBorder, str),
    selectList: {
      item: (str) => paint(palette.headerText, str),
      itemSelected: (str) => paint(C.bgBrightBlue + C.brightWhite, str),
      itemDimmed: (str) => paint(palette.editorPlaceholder, str),
      border: (str) => paint(palette.editorBorder, str),
    },
  }
}

/** Paint the `❯` editor prompt. */
export function promptTag() {
  return paint(palette.editorPrompt, '❯')
}

/** Paint an empty-editor placeholder line. */
export function placeholderText() {
  return paint(palette.editorPlaceholder, ' 输入消息，Enter 发送，/ 查看命令')
}

export { paint }
