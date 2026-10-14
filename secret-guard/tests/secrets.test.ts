import { expect, test } from 'claude-code/testing'

import { blockedReason, isEnvFile, mask } from '../hooks/secrets'

// Token-shaped fixtures are assembled at run time so secret scanners and
// push protection don't read the test file as a leak. None is a real key.
const JWT = ['eyJ' + 'hbGciOiJIUzI1NiJ9', 'eyJ' + 'zdWIiOiJ0ZXN0In0', 'c2lnbmF0dXJlLW5vdC1yZWFs'].join('.')
const AWS_KEY = 'AK' + 'IA' + 'EXAMPLEEXAMPLE12'

test('masks a JWT and an AWS key, keeps placeholders', () => {
  const { text, count } = mask(`token=${JWT}\nkey ${AWS_KEY}\nDEV_ADMIN_PASSWORD=changeme`)
  expect(count).toBe(2)
  expect(text).toContain('[REDACTED:jwt]')
  expect(text).toContain('[REDACTED:aws-access-key]')
  expect(text).toContain('DEV_ADMIN_PASSWORD=changeme')
})

test('blocks .env access from Bash, allows .env.example', () => {
  expect(blockedReason('. ./.env && npm start')).toBeDefined()
  expect(blockedReason('cat apps/api/.env.local')).toBeDefined()
  expect(blockedReason('grep KEY .env')).toBeDefined()
  expect(blockedReason('cp .env.example .env.example.bak')).toBeUndefined()
  expect(blockedReason('ls -la')).toBeUndefined()
  expect(blockedReason('python -m venv .venv')).toBeUndefined()
  expect(blockedReason('jq . ~/.claude.json')).toBeDefined()
})

test('literal heredoc bodies are text, expanding ones are still checked', () => {
  expect(blockedReason("cat > notes.md <<'EOF'\nnever commit .env files\nEOF\necho done")).toBeUndefined()
  expect(blockedReason("cat > notes.md <<'EOF'\ntext\nEOF\ncat .env")).toBeDefined()
  expect(blockedReason('cat > out <<EOF\n$(cat .env)\nEOF')).toBeDefined()
})

test('.env paths are recognised for the Read tool', () => {
  expect(isEnvFile('/repo/.env')).toBe(true)
  expect(isEnvFile('/repo/apps/api/.env.production')).toBe(true)
  expect(isEnvFile('/repo/.env.example')).toBe(false)
  expect(isEnvFile('/repo/src/env.ts')).toBe(false)
})

test('a Bash result carrying a JWT reaches the model masked', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: `Authorization: Bearer ${JWT}`, stderr: '', interrupted: false } }))
  const ran = await $.tool.call({ tool: 'Bash', command: 'curl -v https://example.com' })
  expect(ran.deny).toBeUndefined()
  expect(JSON.stringify(ran.result)).not.toContain(JWT)
})

test('reading a .env file is refused', async ($, on) => {
  on('tool.call', { tool: 'Read' }, () => ({ result: { type: 'text', file: { filePath: '/repo/.env', content: 'X=1', numLines: 1, startLine: 1, totalLines: 1 } } }))
  const ran = await $.tool.call({ tool: 'Read', file_path: '/repo/.env' })
  expect(ran.deny).toBeDefined()
})
