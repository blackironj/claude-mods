import type { EngineInterface, Register } from 'claude-code'

import { classifierBlock } from './blocked'

const MAX_SHOWN = 600

/** Puts `! <command>` in an empty prompt box and tells the model to hand the command to the user. */
async function handOff($: EngineInterface, command: string, why: string) {
  // Fill only an empty prompt box: replacing would throw away what the user was typing.
  const isFilled = (await $.prompt.read()).text.trim() === '' && (await $.prompt.fill({ text: `! ${command}`, mode: 'replace' })).isFilled
  $.ui.toast(isFilled ? 'approve-blocked: press Enter in your prompt box to run the command' : 'approve-blocked: run the command yourself with !')
  return {
    deny:
      `approve-blocked: ${why}, so it was handed to the user` +
      (isFilled ? ' (placed in their prompt box as a `!` command)' : '') +
      '. Do not retry or work around it. End your turn now with no further tool calls, and show the user ' +
      'this exact line to run, in a code block, `!` included:\n\n' +
      `! ${command}\n\n` +
      'Its output lands in this conversation when they run it.',
  }
}

export const register: Register = on => {
  // Commands the user approved after a block, while their retry runs, so tool.check can let them past the classifier.
  const approved = new Set<string>()

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    const reason = classifierBlock(result)
    if (reason === undefined) return result

    // Another guard (prod-guard) already had the user approve this call: don't ask twice.
    if ((await $.tool.check({ tool: 'Bash', input: { command: e.command } })).decision === 'allow') {
      return handOff($, e.command, `auto mode blocked it although the user had approved it (${reason})`)
    }

    const shown = e.command.length > MAX_SHOWN ? `${e.command.slice(0, MAX_SHOWN)}…` : e.command
    const answer = await $.ui.ask(`Auto mode blocked this command (${reason}). Run it anyway?\n\n${shown}`, {
      header: 'Blocked',
      options: ['Run', "Don't run"],
    })
    if (answer !== 'Run') {
      return {
        deny:
          `approve-blocked: auto mode blocked the command and the user chose not to run it${answer === "Don't run" ? '' : `: ${answer}`}. ` +
          'Do not ask them to run it themselves with `!`; go on without it, or ask what to do instead.',
      }
    }
    approved.add(e.command)
    try {
      const retry = await next(e)
      const again = classifierBlock(retry)
      return again === undefined ? retry : await handOff($, e.command, `auto mode blocked it again after the user chose Run (${again})`)
    } finally {
      approved.delete(e.command)
    }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'approve-blocked: the hook failed; the command did not run.' },
  )

  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const verdict = await next(e)
    const command = (e.input as { command?: string }).command ?? ''
    // Only the classifier's question is answered for the user: a settings deny rule still stands.
    return approved.has(command) && verdict.decision === 'ask'
      ? { decision: 'allow', reason: 'approve-blocked: approved by the user after an auto-mode block' }
      : verdict
  })
}
