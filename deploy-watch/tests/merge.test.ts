import { expect, mock, test } from 'claude-code/testing'

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const FEATURE_HEAD = ok('32d8779aaaa\nfeat/deploy-target-menu\n')

test('after gh pr merge the watch follows the merge commit on the base branch, not the local HEAD', async ($, on) => {
  mock.clock(on)
  on('process.run', (_$, e) =>
    e.argv[0] === 'gh' && e.argv[1] === 'pr' && e.argv[2] === 'view'
      ? ok(JSON.stringify({ state: 'MERGED', baseRefName: 'dev', mergeCommit: { oid: '0486c33bbbb' } }))
      : FEATURE_HEAD,
  )
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '' } }))

  const ran = await $.tool.call({ tool: 'Bash', command: 'cd /repo && gh pr merge 26 --squash --delete-branch' })
  const note = ran.context?.join('\n') ?? ''
  expect(note).toContain('dev@0486c33')
  expect(note).not.toContain('32d8779')
})

test('an auto-merge not yet merged waits on the PR instead of watching the feature branch', async ($, on) => {
  mock.clock(on)
  on('process.run', (_$, e) =>
    e.argv[0] === 'gh' ? ok(JSON.stringify({ state: 'OPEN', baseRefName: 'dev', mergeCommit: null })) : FEATURE_HEAD,
  )
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '' } }))

  const ran = await $.tool.call({ tool: 'Bash', command: 'cd /repo && gh pr merge --auto --squash' })
  expect(ran.context?.join('\n')).toContain("PR feat/deploy-target-menu's merge commit once it merges")
})

test('a failing gh call never fails the Bash command it follows', async ($, on) => {
  mock.clock(on)
  on('process.run', () => ok('not json'))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'merged', stderr: '' } }))

  const ran = await $.tool.call({ tool: 'Bash', command: 'cd /repo && gh pr merge 26 --squash' })
  expect(ran.deny).toBeUndefined()
  expect(ran.result).toEqual({ stdout: 'merged', stderr: '' })
})
