import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { LockReason } from '../types'
import { intentOf, violation } from './rules'

const isLocked = atom({ plugin: 'read-only-lock', key: 'isLocked' } as const, false)
const reason = atom({ plugin: 'read-only-lock', key: 'reason' } as const, null as LockReason | null)

const CONTEXT =
  'read-only-lock is on: the user asked to investigate or plan only. Do not edit files, run mutating commands, ' +
  'or change remote state (git, gh, kubectl, package installs). Report findings or a plan and stop; the user will unlock.'

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || e.isMeta) return next(e)

    const intent = intentOf(e.text)
    if (intent === 'lock') {
      await update($, isLocked, () => true)
      await update($, reason, () => e.text.replace(/\s+/g, ' ').trim().slice(0, 40))
    } else if (intent === 'unlock') {
      await update($, isLocked, () => false)
    }
    return (await read($, isLocked)) ? next({ ...e, context: [...(e.context ?? []), CONTEXT] }) : next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (!(await read($, isLocked))) return next(e)
    const why = violation(String(e.tool), e as { command?: string; file_path?: string; notebook_path?: string })
    return why === undefined
      ? next(e)
      : { deny: `read-only-lock: ${why} is blocked because the user asked to look only. Report what you found or propose the change, and wait for the user to unlock.` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'read-only-lock: the guard failed; the call did not run.' }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isLocked))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const why = await read($, reason)
    return (
      <Box>
        <Text color="yellow">read-only</Text>
        <Text dimColor> · edits blocked{why === null ? '' : ` · "${why}"`} </Text>
        <Button key="unlock" label="Unlock" onPress={() => update($, isLocked, () => false)} />
      </Box>
    )
  })
}
