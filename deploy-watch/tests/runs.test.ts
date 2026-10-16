import { expect, test } from 'claude-code/testing'

import { newSince, SKEW_MS, summarize, trigger } from '../hooks/runs'

test('pushes and PR creation trigger a watch, other commands do not', () => {
  expect(trigger('git push -u origin feat/x')).toEqual({ kind: 'push', dir: '' })
  expect(trigger('cd ../svc && git push')).toEqual({ kind: 'push', dir: '../svc' })
  expect(trigger('git -C ../svc push')).toEqual({ kind: 'push', dir: '../svc' })
  expect(trigger('gh pr create --base dev --title t')).toEqual({ kind: 'pr-create', dir: '' })
  expect(trigger('git status && git log')).toBeUndefined()
  expect(trigger('gh pr view 3')).toBeUndefined()
})

test('a merge names its PR, so the watch can follow the merge commit', () => {
  expect(trigger('gh pr merge 26 --squash --delete-branch 2>&1 | tail -2')).toEqual({ kind: 'pr-merge', dir: '', pr: '26' })
  expect(trigger('gh pr merge --squash -t "title" feat/x')).toEqual({ kind: 'pr-merge', dir: '', pr: 'feat/x' })
  expect(trigger('gh pr merge --auto --squash')).toEqual({ kind: 'pr-merge', dir: '' })
  expect(trigger('gh pr merge 7 -R org/repo --merge')).toEqual({ kind: 'pr-merge', dir: '', repo: 'org/repo', pr: '7' })
})

test('a workflow dispatch is watched by workflow and ref', () => {
  expect(trigger('gh workflow run deploy.yml --ref dev -f env=beta')).toEqual({ kind: 'workflow-run', dir: '', workflow: 'deploy.yml', ref: 'dev' })
  expect(trigger('gh workflow run "Deploy Prod"')).toEqual({ kind: 'workflow-run', dir: '', workflow: 'Deploy Prod' })
  expect(trigger('gh workflow run')).toBeUndefined()
})

test('runs from before the watch started do not count', () => {
  const since = Date.parse('2026-10-16T09:22:00Z')
  const run = (createdAt?: string) => ({ name: 'ci', status: 'completed', conclusion: 'success', url: '', createdAt })
  const old = run(new Date(since - SKEW_MS - 1000).toISOString())
  const skewed = run(new Date(since - SKEW_MS + 1000).toISOString())
  const fresh = run('2026-10-16T09:22:06Z')
  expect(newSince([old, skewed, fresh], since)).toEqual([skewed, fresh])
  expect(newSince([old], undefined)).toEqual([old])
  expect(newSince([run()], since)).toHaveLength(1)
})

test('summary reports running, passed and failed runs', () => {
  const run = (name: string, status: string, conclusion = '') => ({ name, status, conclusion, url: '' })
  expect(summarize([]).isDone).toBe(false)
  expect(summarize([run('build', 'in_progress'), run('lint', 'completed', 'success')]).text).toBe('1/2 running')
  expect(summarize([run('build', 'completed', 'success')])).toEqual({ isDone: true, text: 'CI passed (1 runs)' })
  expect(summarize([run('test', 'completed', 'failure'), run('lint', 'completed', 'success')]).text).toBe('CI failed: test (failure)')
})
