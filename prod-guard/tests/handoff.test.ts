import { expect, test } from 'claude-code/testing'

test('a handed-off aws-vault login tells the model to show the exact ! line and end its turn', async ($, on) => {
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '' } }))

  const command = 'aws-vault login cochl'
  const ran = await $.tool.call({ tool: 'Bash', command })
  expect(ran.deny).toBeDefined()
  expect(ran.deny).toContain(`\n! ${command}\n`)
  expect(ran.deny).toContain('End your turn now')
})

test('a draft in the prompt box is kept: the command is not filled over it', async ($, on) => {
  let isFillCalled = false
  on('prompt.read', () => ({ value: { text: 'half-typed question', cursor: 19 } }))
  on('prompt.fill', () => {
    isFillCalled = true
    return { isFilled: true }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '' } }))

  const ran = await $.tool.call({ tool: 'Bash', command: 'aws-vault login cochl' })
  expect(isFillCalled).toBe(false)
  expect(ran.deny).toContain('\n! aws-vault login cochl\n')
  expect(ran.deny).not.toContain('placed in their prompt box')
})
