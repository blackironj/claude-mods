import { expect, test } from 'claude-code/testing'

import { findSites, rewrite } from '../hooks/plan'

const onto = (command: string, base = 'dev') => rewrite(command, findSites(command), () => base)

test('new branches without a start point get origin/<base>', () => {
  expect(onto('git checkout -b feat/x')).toBe('git fetch origin dev --quiet && git checkout -b feat/x origin/dev')
  expect(onto('git switch -c feat/x 2>&1')).toBe('git fetch origin dev --quiet && git switch -c feat/x 2>&1 origin/dev')
  expect(onto('git -C ../repo worktree add -b feat/x ../wt')).toBe(
    'git -C ../repo fetch origin dev --quiet && git -C ../repo worktree add -b feat/x ../wt origin/dev',
  )
})

test('explicit start points and other commands are left alone', () => {
  expect(findSites('git checkout -b feat/x origin/main')).toHaveLength(0)
  expect(findSites('git checkout main')).toHaveLength(0)
  expect(findSites('git worktree add ../wt feat/x')).toHaveLength(0)
  expect(findSites('gh pr create --base main --title t')).toHaveLength(0)
  expect(findSites('gh pr create --repo o/r --title t')).toHaveLength(0)
  expect(findSites('git switch -C x')).toHaveLength(1)
})

test('gh pr create gets --base, and cd sets the repo dir', () => {
  const command = 'cd ../svc && gh pr create --title "a && b" --body-file /tmp/b.md'
  const sites = findSites(command)
  expect(sites).toHaveLength(1)
  expect(sites[0]?.dir).toBe('../svc')
  expect(onto(command)).toBe('cd ../svc && gh pr create --title "a && b" --body-file /tmp/b.md --base dev')
})
