import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

/** The engine beneath deploy-watch; `runs` answers `gh run list` after `ghDelayMs`. Returns the prompts it submitted. */
function engine(on: On, clock: ReturnType<typeof mock.clock>, runs: () => object[], ghDelayMs = 0): string[] {
  const prompts: string[] = []
  on('prompt.submit', (_$, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal_bell' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'git') return ok('6bfc885aaaa\nmain\n')
    if (ghDelayMs > 0) await clock.sleep(ghDelayMs)
    return ok(JSON.stringify(runs()))
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '' } }))
  return prompts
}

test('a finished CI run is submitted as a prompt, so the model wakes to report it and carry on', async ($, on) => {
  const clock = mock.clock(on)
  const prompts = engine(on, clock, () => [{ name: 'ci', status: 'completed', conclusion: 'success', url: '', createdAt: new Date(clock.now()).toISOString() }])

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ran = await $.tool.call({ tool: 'Bash', command: 'cd /repo && git push' })
  expect(ran.context?.join('\n')).toContain('starts a turn')

  await clock.advance(30_000)
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('deploy-watch: CI passed (1 runs) · main')
})

test('no runs within 10 min is noted in the conversation without waking the model', async ($, on) => {
  const clock = mock.clock(on)
  const session = mock.session(on)
  const prompts = engine(on, clock, () => [])

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'cd /repo && git push' })
  await clock.advance(11 * 60_000)
  expect(prompts).toHaveLength(0)
  expect(JSON.stringify(session.appended())).toContain('No CI runs appeared for main in 10 min')
})

test('overlapping polls announce a finished run once', async ($, on) => {
  const clock = mock.clock(on)
  const run = { name: 'ci', status: 'completed', conclusion: 'success', url: '', createdAt: new Date(clock.now()).toISOString() }
  const prompts = engine(on, clock, () => [run], 45_000)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'cd /repo && git push' })
  await clock.advance(120_000) // polls start at 30 s and 60 s; each gh call takes 45 s, so they overlap
  expect(prompts).toHaveLength(1)
})
