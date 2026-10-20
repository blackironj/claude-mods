import { expect, test } from 'claude-code/testing'

const COMMAND = "kubectl --context=prod -n monitoring get secret bot -o jsonpath='{.data}'"
const OUTPUT = { stdout: 'ok', stderr: '', interrupted: false }
const BLOCKED = {
  isError: true,
  result: undefined,
  text:
    'Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Production Reads]. ' +
    "If you have other tasks that don't depend on this action, continue working on those.",
} as const

test('a blocked command runs once the user picks Run, past the classifier but not past a deny rule', async ($, on) => {
  const decisions: string[] = []
  let core: 'ask' | 'deny' = 'ask'
  let calls = 0
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => ({ result: { answers: { [e.questions[0]?.question ?? '']: 'Run' } } }))
  on('tool.check', { tool: 'Bash' }, () => ({ decision: core }))
  on('tool.call', { tool: 'Bash' }, async (_, e) => {
    calls += 1
    if (calls === 1) return BLOCKED
    for (const decision of ['ask', 'deny'] as const) {
      core = decision
      decisions.push((await $.tool.check({ tool: 'Bash', input: { command: e.command } })).decision)
    }
    core = 'ask'
    return { result: OUTPUT }
  })

  const ran = await $.tool.call({ tool: 'Bash', command: COMMAND })
  expect(ran.deny).toBeUndefined()
  expect(ran.isError).toBeUndefined()
  expect(calls).toBe(2)
  expect(decisions).toEqual(['allow', 'deny'])
  expect((await $.tool.check({ tool: 'Bash', input: { command: COMMAND } })).decision).toBe('ask')
})

test("a blocked command the user declines does not run, and the model is told not to hand it over with !", async ($, on) => {
  let calls = 0
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => ({ result: { answers: { [e.questions[0]?.question ?? '']: "Don't run" } } }))
  on('tool.check', { tool: 'Bash' }, () => ({ decision: 'ask' }))
  on('tool.call', { tool: 'Bash' }, () => {
    calls += 1
    return BLOCKED
  })

  const ran = await $.tool.call({ tool: 'Bash', command: COMMAND })
  expect(calls).toBe(1)
  expect(ran.deny).toContain('chose not to run it')
  expect(ran.deny).toContain('Do not ask them to run it themselves')
})

test('a retry the classifier blocks again goes to the prompt box as a ! command', async ($, on) => {
  let filled = ''
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => ({ result: { answers: { [e.questions[0]?.question ?? '']: 'Run' } } }))
  on('tool.check', { tool: 'Bash' }, () => ({ decision: 'ask' }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    filled = e.text
    return { isFilled: true }
  })
  on('tool.call', { tool: 'Bash' }, () => BLOCKED)

  const ran = await $.tool.call({ tool: 'Bash', command: COMMAND })
  expect(filled).toBe(`! ${COMMAND}`)
  expect(ran.deny).toContain(`\n! ${COMMAND}\n`)
  expect(ran.deny).toContain('End your turn now')
})

test('a call another guard already had the user approve is handed over without asking again', async ($, on) => {
  let isAsked = false
  on('tool.call', { tool: 'AskUserQuestion' }, () => {
    isAsked = true
    return { result: { answers: {} } }
  })
  on('tool.check', { tool: 'Bash' }, () => ({ decision: 'allow' }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('tool.call', { tool: 'Bash' }, () => BLOCKED)

  const ran = await $.tool.call({ tool: 'Bash', command: COMMAND })
  expect(isAsked).toBe(false)
  expect(ran.deny).toContain(`\n! ${COMMAND}\n`)
})

test('a command that was not blocked is not asked about', async ($, on) => {
  let isAsked = false
  on('tool.call', { tool: 'AskUserQuestion' }, () => {
    isAsked = true
    return { result: { answers: {} } }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: OUTPUT }))

  const ran = await $.tool.call({ tool: 'Bash', command: 'kubectl --context=prod get pods' })
  expect(isAsked).toBe(false)
  expect(ran.deny).toBeUndefined()
})
