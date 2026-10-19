import { expect, test } from 'claude-code/testing'

const COMMAND = "kubectl --context=prod -n monitoring get secret bot -o jsonpath='{.data}'"
const OUTPUT = { stdout: 'ok', stderr: '', interrupted: false }

test('a blocked command runs once the user picks Run, past the classifier but not past a deny rule', async ($, on) => {
  const decisions: string[] = []
  let core: 'ask' | 'deny' = 'ask'
  let calls = 0
  let isApproved = false
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => ({ result: { answers: { [e.questions[0]?.question ?? '']: 'Run' } } }))
  on('classic.PermissionDenied', () => ({}))
  on('tool.check', { tool: 'Bash' }, () => ({ decision: core }))
  on('tool.call', { tool: 'Bash' }, async (_, e) => {
    calls += 1
    if (!isApproved) {
      isApproved = true
      await $.classic.PermissionDenied({ tool_name: 'Bash', tool_input: { command: e.command }, tool_use_id: e.tool_use_id ?? '', reason: 'reads a production secret' })
      return { isError: true, result: undefined, text: 'Permission denied by auto mode' }
    }
    for (const decision of ['ask', 'deny'] as const) {
      core = decision
      decisions.push((await $.tool.check({ tool: 'Bash', input: { command: e.command } })).decision)
    }
    return { result: OUTPUT }
  })

  const ran = await $.tool.call({ tool: 'Bash', command: COMMAND })
  expect(ran.deny).toBeUndefined()
  expect(ran.isError).toBeUndefined()
  expect(calls).toBe(2)
  expect(decisions).toEqual(['allow', 'deny'])
  core = 'ask'
  expect((await $.tool.check({ tool: 'Bash', input: { command: COMMAND } })).decision).toBe('ask')
})

test("a blocked command the user declines does not run, and the model is told not to hand it over with !", async ($, on) => {
  let calls = 0
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => ({ result: { answers: { [e.questions[0]?.question ?? '']: "Don't run" } } }))
  on('classic.PermissionDenied', () => ({}))
  on('tool.call', { tool: 'Bash' }, async (_, e) => {
    calls += 1
    await $.classic.PermissionDenied({ tool_name: 'Bash', tool_input: { command: e.command }, tool_use_id: e.tool_use_id ?? '', reason: 'reads a production secret' })
    return { isError: true, result: undefined, text: 'Permission denied by auto mode' }
  })

  const ran = await $.tool.call({ tool: 'Bash', command: COMMAND })
  expect(calls).toBe(1)
  expect(ran.deny).toContain('chose not to run it')
  expect(ran.deny).toContain('Do not ask them to run it themselves')
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
