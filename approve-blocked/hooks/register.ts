import type { Register } from 'claude-code'

const MAX_SHOWN = 600

export const register: Register = on => {
  // Classifier reasons by tool_use_id, recorded while the call is being decided.
  const blocked = new Map<string, string>()
  // Commands the user approved after a block, while their retry runs, so tool.check can let them past the classifier.
  const approved = new Set<string>()

  on('classic.PermissionDenied', ($, e, next) => {
    if (e.tool_name === 'Bash') blocked.set(e.tool_use_id, e.reason)
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    const id = e.tool_use_id
    const reason = id === undefined ? undefined : blocked.get(id)
    if (id === undefined || reason === undefined) return result
    blocked.delete(id)

    const shown = e.command.length > MAX_SHOWN ? `${e.command.slice(0, MAX_SHOWN)}…` : e.command
    const answer = await $.ui.ask(`Auto mode blocked this command: ${reason}\n\n${shown}\n\nRun it anyway?`, {
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
      return await next(e)
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
