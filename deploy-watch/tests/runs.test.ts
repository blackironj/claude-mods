import { expect, test } from 'claude-code/testing'

import { summarize, triggerDir } from '../hooks/runs'

test('pushes and PR creation trigger a watch, other commands do not', () => {
  expect(triggerDir('git push -u origin feat/x')).toBe('')
  expect(triggerDir('cd ../svc && git push')).toBe('../svc')
  expect(triggerDir('git -C ../svc push')).toBe('../svc')
  expect(triggerDir('gh pr create --base dev --title t')).toBe('')
  expect(triggerDir('git status && git log')).toBeUndefined()
  expect(triggerDir('gh pr view 3')).toBeUndefined()
})

test('summary reports running, passed and failed runs', () => {
  const run = (name: string, status: string, conclusion = '') => ({ name, status, conclusion, url: '' })
  expect(summarize([]).isDone).toBe(false)
  expect(summarize([run('build', 'in_progress'), run('lint', 'completed', 'success')]).text).toBe('1/2 running')
  expect(summarize([run('build', 'completed', 'success')])).toEqual({ isDone: true, text: 'CI passed (1 runs)' })
  expect(summarize([run('test', 'completed', 'failure'), run('lint', 'completed', 'success')]).text).toBe('CI failed: test (failure)')
})
