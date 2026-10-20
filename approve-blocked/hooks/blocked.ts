import type { ToolCallResult } from 'claude-code'

const CLASSIFIER_BLOCK = /denied by the Claude Code auto mode classifier/

/** The classifier's reason when a call's result is an auto-mode block, else undefined. */
export function classifierBlock(result: ToolCallResult): string | undefined {
  const text = result.deny ?? (result.isError === true ? result.text : undefined)
  if (text === undefined || !CLASSIFIER_BLOCK.test(text)) return undefined
  return /Reason: (.+?)\. If you have/s.exec(text)?.[1] ?? 'no reason given'
}
