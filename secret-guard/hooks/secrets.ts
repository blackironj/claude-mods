// Token shapes worth masking: each has a fixed prefix or structure, so dev
// placeholders such as DEV_ADMIN_PASSWORD=changeme are left alone.
const PATTERNS: readonly [string, RegExp][] = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['aws-secret', /(aws_secret_access_key\s*[=:]\s*["']?)[A-Za-z0-9/+=]{40}/gi],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
]

/** Masks known token shapes; returns the text and how many were masked. */
export function mask(text: string): { text: string; count: number } {
  let count = 0
  let out = text
  for (const [name, re] of PATTERNS) {
    out = out.replace(re, (match: string, prefix?: unknown) => {
      count++
      return `${typeof prefix === 'string' ? prefix : ''}[REDACTED:${name}]`
    })
  }
  return { text: out, count }
}

// `.env`, `.env.local`, `.env.prod`, but not `.env.example` / `.sample` /
// `.template` / `.dist`, as a word or path component.
const ENV_FILE = /(?:^|[\s'"=<>:/(])\.env(?:\.(?!example\b|sample\b|template\b|dist\b)[\w-]+)?(?=$|[\s'";|&)<>])/
const CLAUDE_CONFIG = /(?:~|\$HOME|\/home\/[^/\s]+)\/\.claude(?:\.json|\/config\.json)\b/

// A heredoc with a quoted delimiter (<<'EOF') is literal text, not commands;
// an unquoted one still expands $(...), so its body stays in the check.
const LITERAL_HEREDOC = /<<-?\s*(['"])(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2[ \t]*(?=\n|$)/g

/** Whether a file path names a .env file (not an example/template). */
export function isEnvFile(path: string): boolean {
  return ENV_FILE.test(path)
}

/** Why a Bash command must not run, or undefined when it may. */
export function blockedReason(command: string): string | undefined {
  const code = command.replace(LITERAL_HEREDOC, '')
  if (ENV_FILE.test(code)) return 'it touches a .env file'
  if (CLAUDE_CONFIG.test(code)) return 'it touches ~/.claude.json or ~/.claude/config.json'
  return undefined
}
