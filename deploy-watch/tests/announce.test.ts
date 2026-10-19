import { expect, mock, test } from 'claude-code/testing'

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

test('a finished CI run is submitted as a prompt, so the model wakes to report it and carry on', async ($, on) => {
  const clock = mock.clock(on)
  const prompts: string[] = []
  on('prompt.submit', (_$, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal_bell' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', (_$, e) =>
    e.argv[0] === 'git'
      ? ok('6bfc885aaaa\nmain\n')
      : ok(JSON.stringify([{ name: 'ci', status: 'completed', conclusion: 'success', url: '', createdAt: new Date(clock.now()).toISOString() }])),
  )
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '' } }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ran = await $.tool.call({ tool: 'Bash', command: 'cd /repo && git push' })
  expect(ran.context?.join('\n')).toContain('starts a turn')

  await clock.advance(30_000)
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('deploy-watch: CI passed (1 runs) · main')
})
