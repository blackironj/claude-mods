import type { EngineInterface, Register } from 'claude-code'

import { classifierBlock } from './blocked'
import { classify, type Policy } from './classify'

const MAX_SHOWN = 600

function policyOf(options: Readonly<Record<string, unknown>>): Policy {
  const contexts = String(options.prodContexts ?? 'prod')
  return {
    prodContexts: contexts.split(',').map(c => c.trim()).filter(c => c !== ''),
    requireContext: options.requireContext !== false,
  }
}

/** Puts `! <command>` in an empty prompt box and tells the model to hand the command to the user. */
async function handOff($: EngineInterface, command: string, why: string) {
  // Fill only an empty prompt box: replacing would throw away what the user was typing.
  const isFilled = (await $.prompt.read()).text.trim() === '' && (await $.prompt.fill({ text: `! ${command}`, mode: 'replace' })).isFilled
  $.ui.toast(isFilled ? 'prod-guard: review the command in your prompt box, then press Enter to run it' : 'prod-guard: run the command yourself with !')
  return {
    deny:
      `prod-guard: ${why}, so it was handed to the user` +
      (isFilled ? ' (placed in their prompt box as a `!` command)' : '') +
      '. Do not retry or work around it. End your turn now with no further tool calls, and show the user ' +
      'this exact line to run, in a code block, `!` included:\n\n' +
      `! ${command}\n\n` +
      'Its output lands in this conversation when they run it; a `!` command typed while you are still working does not run.',
  }
}

export const register: Register = (on, options) => {
  const policy = policyOf(options)
  // Commands the user confirmed, while they run, so tool.check can let them past the
  // auto-mode classifier (keyed by command so approve-blocked's tool.check query sees them).
  const confirmed = new Set<string>()

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const verdict = classify(e.command, policy)

    switch (verdict.kind) {
      case 'pass':
        return next(e)
      case 'deny':
        return { deny: `prod-guard: ${verdict.why}.` }
      case 'handoff':
        return handOff($, e.command, verdict.why)
      case 'confirm': {
        const shown = e.command.length > MAX_SHOWN ? `${e.command.slice(0, MAX_SHOWN)}…` : e.command
        const answer = await $.ui.ask(`${verdict.why}. Run this command?\n\n${shown}`, {
          header: 'prod-guard',
          options: ['Run', 'Cancel'],
        })
        if (answer !== 'Run') {
          return { deny: `prod-guard: the user declined (${verdict.why})${answer === 'Cancel' ? '' : `: ${answer}`}.` }
        }
        confirmed.add(e.command)
        try {
          const result = await next(e)
          const reason = classifierBlock(result)
          return reason === undefined ? result : await handOff($, e.command, `auto mode still blocked it after you confirmed (${reason})`)
        } finally {
          confirmed.delete(e.command)
        }
      }
    }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'prod-guard: the guard failed or the question was dismissed; the command did not run.' },
  )

  on('tool.check', { tool: 'Bash' }, ($, e, next) => {
    const command = (e.input as { command?: string }).command ?? ''
    return confirmed.has(command)
      ? { decision: 'allow', reason: 'prod-guard: confirmed by the user' }
      : next(e)
  })
}
