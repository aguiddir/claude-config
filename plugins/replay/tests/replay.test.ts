import { expect, test } from 'claude-code/testing'

import { createdHunk, toPatch } from '../hooks/patch'

const hunk = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }

test('hunks become a unified diff, whole hunks only', async () => {
  expect(toPatch([hunk])).toEqual({ patch: '@@ -1,1 +1,1 @@\n-a\n+b', omitted: 0 })
  const big = { ...hunk, lines: ['+' + 'x'.repeat(9_990)] }
  expect(toPatch([hunk, big]).omitted).toBe(1)
  expect(toPatch([{ ...hunk, lines: ['+a\u0007b'] }]).patch).toBe('@@ -1,1 +1,1 @@\n+ab')
})

test('a created file is one added hunk', async () => {
  expect(createdHunk('x\ny\n')).toEqual({ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+x', '+y'] })
})

const EDIT = {
  result: {
    filePath: '/repo/a.ts', oldString: 'a', newString: 'b', originalFile: 'a', structuredPatch: [hunk],
    userModified: false, replaceAll: false,
  },
}

test("a turn's edits are offered, then replayed above the prompt with r, n, p, q", async ($, on) => {
  on('tool.call', { tool: 'Edit' }, (_$, e) => ({ result: { ...EDIT.result, filePath: e.file_path } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'done' }))
  on('prompt.edit', (_$, e) => ({ text: e.text + e.inputText, cursor: e.cursor + e.inputText.length }))
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/b.ts', old_string: 'a', new_string: 'b' })
  await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, turnId: 't1' })

  // The kit's typings leave prompt.edit off the test's $, though it runs it.
  const prompt = $.prompt as unknown as { edit: (e: unknown) => Promise<{ text: string }> }
  const typeKey = (text: string, key: string) =>
    prompt.edit({ origin: { kind: 'composer' }, text, cursor: text.length, start: text.length, end: text.length, inputText: key })
  const band = async (surface: 'terminal' | 'desktop') =>
    $.ui.mount({ plugin: 'replay', surface, component: 'AbovePrompt', props: { hasSurvey: false } as never })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await band(surface)
    expect(await ui.find({ text: /2 édition/ })).toBeDefined()
    await ui.unmount()
  }
  expect(await typeKey('fo', 'r')).toMatchObject({ text: 'for' })
  expect(await typeKey('', 'r')).toMatchObject({ text: '' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await band(surface)
      expect(await ui.find({ text: /a\.ts/ })).toBeDefined()
    await ui.unmount()
  }
  expect(await typeKey('', 'n')).toMatchObject({ text: '' })
  const second = await band('terminal')
  expect(await second.find({ text: /b\.ts/ })).toBeDefined()
  await second.unmount()
  await typeKey('', 'q')
  // Closed: the band is gone and the letters type again.
  expect(await typeKey('', 'n')).toMatchObject({ text: 'n' })
  expect(await typeKey('', 'r')).toMatchObject({ text: 'r' })
})
