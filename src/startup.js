/**
 * dsh-tui startup: parse this app's own command line and provide the parsed
 * values as the `tuiStartup` service. The runner row below injects it and
 * reads its config through `!!js` expressions, exactly like the headless
 * bundle's startup/runner split.
 *
 * @module dsh-tui/startup
 */

const { Command } = await import('commander')
const { parseCmdline } = await import('@deepseek-ai/dsh-cmdline')

/** Stable Cordis plugin name. */
export const name = 'tui-startup'

/** Services required before the command line can be parsed. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the runner row. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/**
 * Parse and provide the TUI options as an ordinary Cordis service.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx) {
  const program = new Command()
    .name('dsh --profile tui')
    .description('An interactive terminal UI for dsh.')
    .helpOption('-h, --help', 'show this help')
    .option('--resume <sessionId>', 'resume an existing session instead of starting a new one')
    .addHelpText('after', `
Examples:
  dsh --profile tui                       start a new interactive session
  dsh --profile tui --resume <id>         resume a previous session
`)
  program.action(() => {
    const opts = program.opts()
    ctx.provide(TUI_STARTUP_SERVICE, {
      ...(opts.resume !== undefined ? { resume: opts.resume } : {}),
    })
  })
  parseCmdline(ctx, program)
}
