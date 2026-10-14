import type { Register } from 'claude-code'

import { classify, type Policy } from './classify'

const MAX_SHOWN = 600

function policyOf(options: Readonly<Record<string, unknown>>): Policy {
  const contexts = String(options.prodContexts ?? 'prod')
  return {
    prodContexts: contexts.split(',').map(c => c.trim()).filter(c => c !== ''),
    requireContext: options.requireContext !== false,
  }
}

export const register: Register = (on, options) => {
  const policy = policyOf(options)
  // Calls the user confirmed, keyed by tool_use_id (or the command when a
  // call has none), so tool.check can let them past the auto-mode classifier.
  const confirmed = new Set<string>()

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const verdict = classify(e.command, policy)
    const key = e.tool_use_id ?? e.command

    switch (verdict.kind) {
      case 'pass':
        return next(e)
      case 'deny':
        return { deny: `prod-guard: ${verdict.why}.` }
      case 'handoff': {
        const filled = await $.prompt.fill({ text: `! ${e.command}`, mode: 'replace' })
        $.ui.toast(filled.isFilled ? 'prod-guard: review the command in your prompt box, then press Enter to run it' : 'prod-guard: run the aws-vault command yourself with !')
        return {
          deny:
            `prod-guard: ${verdict.why}, so it was handed to the user` +
            (filled.isFilled ? ' (placed in their prompt box as a `!` command)' : '') +
            '. Do not retry it; wait for the user to run it and share the output.',
        }
      }
      case 'confirm': {
        const shown = e.command.length > MAX_SHOWN ? `${e.command.slice(0, MAX_SHOWN)}…` : e.command
        const answer = await $.ui.ask(`${verdict.why}. Run this command?\n\n${shown}`, {
          header: 'prod-guard',
          options: ['Run', 'Cancel'],
        })
        if (answer !== 'Run') {
          return { deny: `prod-guard: the user declined (${verdict.why})${answer === 'Cancel' ? '' : `: ${answer}`}.` }
        }
        confirmed.add(key)
        try {
          return await next(e)
        } finally {
          confirmed.delete(key)
        }
      }
    }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'prod-guard: the guard failed or the question was dismissed; the command did not run.' },
  )

  on('tool.check', { tool: 'Bash' }, ($, e, next) => {
    const command = (e.input as { command?: string }).command ?? ''
    return confirmed.has(e.tool_use_id ?? command)
      ? { decision: 'allow', reason: 'prod-guard: confirmed by the user' }
      : next(e)
  })
}
