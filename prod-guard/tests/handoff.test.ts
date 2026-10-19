import { expect, test } from 'claude-code/testing'

test('a handed-off aws-vault login tells the model to show the exact ! line and end its turn', async ($, on) => {
  on('prompt.fill', () => ({ isFilled: true }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '' } }))

  const command = 'aws-vault login cochl'
  const ran = await $.tool.call({ tool: 'Bash', command })
  expect(ran.deny).toBeDefined()
  expect(ran.deny).toContain(`\n! ${command}\n`)
  expect(ran.deny).toContain('End your turn now')
})
