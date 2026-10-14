import type { Register } from 'claude-code'

import { blockedReason, isEnvFile, mask } from './secrets'

const WITHHELD = 'secret-guard: masking failed, so the output was withheld.'

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const why = blockedReason(e.command)
    if (why !== undefined) {
      return { deny: `secret-guard: blocked because ${why}. Refer to variables by name, or ask the user to check the value.` }
    }

    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    if (ran.isError === true) {
      const masked = mask(ran.text ?? '')
      return masked.count === 0 ? ran : { deny: `the command failed; output with ${masked.count} secret(s) masked:\n${masked.text}` }
    }

    const out = mask(ran.result.stdout)
    const err = mask(ran.result.stderr)
    if (out.count + err.count === 0) return ran
    $.ui.toast(`secret-guard: masked ${out.count + err.count} secret(s) in Bash output`)
    return { result: { ...ran.result, stdout: out.text, stderr: err.text }, context: ran.context }
  }).catch(($, e, next) => (next.called ? { deny: WITHHELD } : { deny: 'secret-guard: the guard failed; the command did not run.' }))

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    if (isEnvFile(e.file_path)) {
      return { deny: 'secret-guard: reading .env files is blocked. Refer to variables by name, or ask the user to check the value.' }
    }
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || ran.result.type !== 'text') return ran
    const masked = mask(ran.result.file.content)
    if (masked.count === 0) return ran
    $.ui.toast(`secret-guard: masked ${masked.count} secret(s) in ${ran.result.file.filePath}`)
    return { result: { ...ran.result, file: { ...ran.result.file, content: masked.text } }, context: ran.context }
  }).catch(($, e, next) => (next.called ? { deny: WITHHELD } : { deny: 'secret-guard: the guard failed; the file was not read.' }))
}
