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

test("a turn's edits are recorded and drawn in the pane", async ($, on) => {
  on('tool.call', { tool: 'Edit' }, () => ({
    result: {
      filePath: '/repo/a.ts', oldString: 'a', newString: 'b', originalFile: 'a', structuredPatch: [hunk],
      userModified: false, replaceAll: false,
    },
  }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'done' }))
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
  await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, turnId: 't1' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'replay', surface, component: 'Pane', requestId: 'replay',
      props: { title: 'Replay', isFocused: true, bodyColumns: 80, placement: 'dock' } as never,
    })
    expect(await ui.find({ text: /1\/1/ })).toBeDefined()
    expect(await ui.find({ text: /a\.ts/ })).toBeDefined()
    expect(await ui.find({ key: 'next' })).toBeDefined()
    await ui.unmount()
  }
})

test('after a turn with edits, the band offers the replay and r opens it', async ($, on) => {
  let opened = 0
  on('tool.call', { tool: 'Edit' }, () => ({
    result: {
      filePath: '/repo/a.ts', oldString: 'a', newString: 'b', originalFile: 'a', structuredPatch: [hunk],
      userModified: false, replaceAll: false,
    },
  }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'done' }))
  on('ui.open', () => (opened++, { value: { isPlaced: true } }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
  await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, turnId: 't1' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'replay', surface, component: 'AbovePrompt', props: { hasSurvey: false } as never })
    expect(await band.find({ text: /1 édition/ })).toBeDefined()
    await band.unmount()
  }
  expect(await $.prompt.submit({ text: 'r' } as never)).toEqual({ drop: 'Replay ouvert.' })
  expect(opened).toBe(1)
  expect(await $.prompt.submit({ text: 'r' } as never)).toEqual({ text: 'r' })
})
