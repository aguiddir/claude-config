import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Step } from '../types'
import { createdHunk, toPatch } from './patch'
import type { Hunk } from './patch'

const PANE = 'replay'
const pending = atom({ plugin: 'replay', key: 'pending' } as const, [])
const steps = atom({ plugin: 'replay', key: 'steps' } as const, [])
const at = atom({ plugin: 'replay', key: 'at' } as const, 0)
// The band offering the replay, from a turn with edits to the next prompt.
const hint = atom({ plugin: 'replay', key: 'hint' } as const, false)

const openReplay = async ($: EngineInterface) => {
  if ((await read($, steps)).length === 0) return false
  await update($, at, () => 0)
  await update($, hint, () => false)
  await $.ui.open({ id: PANE, title: 'Replay', focus: true, closeOnEscape: true })
  return true
}

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
    if (!e.agentId && recorded.length) {
      await update($, steps, () => recorded)
      await update($, hint, () => true)
    }
    return r
  })

  // While the band shows, `r` typed into an empty prompt opens the replay
  // and never reaches the box; any prompt sent takes the band down.
  on('prompt.edit', async ($, e, next) => {
    const isR = e.text === '' && e.inputText.toLowerCase() === 'r'
    if (isR && (await read($, hint)) && (await openReplay($))) return { text: e.text, cursor: e.cursor }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, hint, () => false)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const count = (await read($, steps)).length
    if (e.props.hasSurvey || !(await read($, hint)) || count === 0) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box>
        <Text color="magenta">↺ {count} édition(s) au dernier tour · </Text>
        <Button key="replay" label="rejouer" hotkey="r" plain onPress={() => void openReplay($)} />
        <Text dimColor> (ou /replay)</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const list = await read($, steps)
    const i = Math.min(await read($, at), Math.max(0, list.length - 1))
    const step = list[i]
    if (!step) return <Text dimColor>Aucune édition à rejouer.</Text>
    const go = (d: number) => () => update($, at, n => Math.max(0, Math.min(list.length - 1, n + d)))
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="cyan">
            {i + 1}/{list.length}
          </Text>{' '}
          {step.tool} <Text dimColor>{step.path}</Text>
        </Text>
        {step.patch ? <Code format="diff" source={step.patch} path={step.path} /> : <Text dimColor>diff trop long pour s'afficher</Text>}
        {step.omitted > 0 && <Text dimColor>… {step.omitted} bloc(s) non affichés</Text>}
        <Box>
          <Button key="prev" label="Préc." hotkey="p" onPress={go(-1)} />
          <Button key="next" label="Suiv." hotkey="n" variant="primary" autoFocus onPress={go(1)} />
          <Button key="close" label="Fermer" hotkey="q" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
