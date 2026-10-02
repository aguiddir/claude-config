import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Step } from '../types'
import { createdHunk, toPatch } from './patch'
import type { Hunk } from './patch'

const pending = atom({ plugin: 'replay', key: 'pending' } as const, [])
const steps = atom({ plugin: 'replay', key: 'steps' } as const, [])
const at = atom({ plugin: 'replay', key: 'at' } as const, 0)
// The band offering the replay, from a turn with edits to the next prompt.
const hint = atom({ plugin: 'replay', key: 'hint' } as const, false)
// The replay itself, drawn in the band above the prompt: a pane would dock
// beside a fullscreen transcript, and its placement is not the mod's to pick.
const isOpen = atom({ plugin: 'replay', key: 'isOpen' } as const, false)

const openReplay = async ($: EngineInterface) => {
  if ((await read($, steps)).length === 0) return false
  await update($, at, () => 0)
  await update($, hint, () => false)
  await update($, isOpen, () => true)
  return true
}

const go = async ($: EngineInterface, d: number) => {
  const last = (await read($, steps)).length - 1
  await update($, at, n => Math.max(0, Math.min(last, n + d)))
}
const close = ($: EngineInterface) => update($, isOpen, () => false)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'replay', description: "Step through the last turn's file edits" })
    return r
  })

  on('command.run', { command: 'replay' }, async $ => ({
    text: (await openReplay($)) ? 'Replay des éditions du dernier tour.' : 'Aucune édition au dernier tour.',
  }))

  // Observes only: the edit runs as it would, its own patch is recorded.
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if ((e.tool !== 'Edit' && e.tool !== 'Write') || r.deny !== undefined || r.isError) return r
    const result = r.result as { filePath: string; structuredPatch?: Hunk[]; type?: string; content?: string }
    const hunks = result.structuredPatch?.length
      ? result.structuredPatch
      : result.type === 'create' && result.content !== undefined
        ? [createdHunk(result.content)]
        : []
    if (hunks.length) {
      const step: Step = { tool: e.tool, path: result.filePath, ...toPatch(hunks) }
      await update($, pending, list => [...list, step])
    }
    return r
  })

  // turn.start is the main loop's alone; a subagent's edits join its turn.
  on('turn.start', async ($, e, next) => {
    await update($, pending, () => [])
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const recorded = await read($, pending)
    // Every main turn replaces the replay, an empty one included: /replay
    // is the last turn's, never an older one's.
    if (!e.agentId) {
      await update($, steps, () => recorded)
      if (recorded.length) await update($, hint, () => true)
    }
    return r
  })

  // A letter typed at the prompt never presses a band Button, so the keys are
  // caught here, in an empty prompt only: `r` opens the replay from the hint,
  // then `n`, `p` and `q` step and close it. None of them reach the box.
  on('prompt.edit', async ($, e, next) => {
    const key = e.text === '' ? e.inputText.toLowerCase() : ''
    const consumed = { text: e.text, cursor: e.cursor }
    if (await read($, isOpen)) {
      if (key === 'n') return (await go($, 1), consumed)
      if (key === 'p') return (await go($, -1), consumed)
      if (key === 'q') return (await close($), consumed)
    } else if (key === 'r' && (await read($, hint)) && (await openReplay($))) return consumed
    return next(e)
  })

  // Any prompt sent takes the hint and the replay down.
  on('prompt.submit', async ($, e, next) => {
    await update($, hint, () => false)
    await close($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, steps)
    if (e.props.hasSurvey || list.length === 0) return next(e)
    const { Box, Text, Button, Code } = $.ui.resolve(e)

    if (await read($, isOpen)) {
      const i = Math.min(await read($, at), list.length - 1)
      const step = list[i]!
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="magenta">
          <Text>
            {list.map((_, n) => (
              <Text color={n === i ? 'magenta' : undefined} dimColor={n !== i}>
                {' '}
                {n + 1}
              </Text>
            ))}
            {'  '}
            {step.tool} <Text dimColor>{step.path}</Text>
          </Text>
          {step.patch ? (
            <Code format="diff" source={step.patch} path={step.path} />
          ) : (
            <Text dimColor>diff trop long pour s'afficher</Text>
          )}
          {step.omitted > 0 && <Text dimColor>… {step.omitted} bloc(s) non affichés</Text>}
          <Box>
            <Button key="prev" label="préc." hotkey="p" plain onPress={() => void go($, -1)} />
            <Text> </Text>
            <Button key="next" label="suiv." hotkey="n" plain onPress={() => void go($, 1)} />
            <Text> </Text>
            <Button key="close" label="fermer" hotkey="q" plain onPress={() => void close($)} />
          </Box>
        </Box>
      )
    }

    if (!(await read($, hint))) return next(e)
    return (
      <Box>
        <Text color="magenta">↺ {list.length} édition(s) au dernier tour · </Text>
        <Button key="replay" label="rejouer" hotkey="r" plain onPress={() => void openReplay($)} />
        <Text dimColor> (ou /replay)</Text>
      </Box>
    )
  })
}
