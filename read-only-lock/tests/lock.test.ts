import { expect, test } from 'claude-code/testing'

import { intentOf, violation } from '../hooks/rules'

test('English look-only prompts lock, explicit go-aheads unlock', () => {
  expect(intentOf('Just investigate the failing test for now')).toBe('lock')
  expect(intentOf("Plan first, don't change anything yet")).toBe('lock')
  expect(intentOf('Review only, no changes please')).toBe('lock')
  expect(intentOf('Looks good, go ahead')).toBe('unlock')
  expect(intentOf('Apply it')).toBe('unlock')
  expect(intentOf('Show me more logs')).toBe('none')
})

test('Korean triggers work as well', () => {
  expect(intentOf('일단 원인 파악부터 해줘')).toBe('lock')
  expect(intentOf('수정하지 말고 확인만 해')).toBe('lock')
  expect(intentOf('계획부터 잡아줘')).toBe('lock')
  expect(intentOf('확인만 하고 진행하지 마')).toBe('lock')
  expect(intentOf('좋아 그대로 수정해줘')).toBe('unlock')
  expect(intentOf('진행해')).toBe('unlock')
  expect(intentOf('로그 더 보여줘')).toBe('none')
})

test('edits and mutating commands violate the lock, reads do not', () => {
  expect(violation('Edit', { file_path: '/repo/a.go' })).toBeDefined()
  expect(violation('Write', { file_path: '/tmp/claude-1000/x/scratch.md' })).toBeUndefined()
  expect(violation('Bash', { command: 'git commit -F /tmp/msg' })).toBeDefined()
  expect(violation('Bash', { command: 'gh pr merge 12 --squash' })).toBeDefined()
  expect(violation('Bash', { command: 'echo x > notes.txt' })).toBeDefined()
  expect(violation('Bash', { command: 'git log --oneline | head -5 2>&1' })).toBeUndefined()
  expect(violation('Bash', { command: 'git branch -a && git stash list' })).toBeUndefined()
  expect(violation('Bash', { command: 'gh pr view 12 --json title > /dev/null' })).toBeUndefined()
  expect(violation('Bash', { command: 'gh api repos/o/r/pulls/1' })).toBeUndefined()
  expect(violation('Bash', { command: 'gh api -X PATCH repos/o/r/pulls/1 -f title=x' })).toBeDefined()
  expect(violation('Bash', { command: 'kubectl --context=beta get pods' })).toBeUndefined()
  expect(violation('Read', { file_path: '/repo/a.go' })).toBeUndefined()
})

test('after a look-only prompt an Edit is denied', async ($, on) => {
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  on('tool.call', () => ({ result: { ok: true } }))
  await $.prompt.submit({ text: '수정하지 말고 원인 파악부터 해줘', wait: false, origin: { kind: 'composer' } })
  const denied = await $.tool.call({ tool: 'Edit', file_path: '/repo/a.go', old_string: 'a', new_string: 'b' })
  expect(denied.deny).toBeDefined()
  await $.prompt.submit({ text: '좋아 수정해', wait: false, origin: { kind: 'composer' } })
  const allowed = await $.tool.call({ tool: 'Edit', file_path: '/repo/a.go', old_string: 'a', new_string: 'b' })
  expect(allowed.deny).toBeUndefined()
})
