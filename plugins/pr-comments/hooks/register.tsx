import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Pr, Thread } from '../types'
import { MINE, QUERY, REPLY, RESOLVE, hunkTail, reviewHeader, reviewPrompt, toPrs, where } from './threads'

const PANE = 'pr-review'
const prs = atom({ plugin: 'pr-comments', key: 'prs' } as const, [])
const branch = atom({ plugin: 'pr-comments', key: 'branch' } as const, '')
const shownPr = atom({ plugin: 'pr-comments', key: 'shownPr' } as const, null)
const sent = atom({ plugin: 'pr-comments', key: 'sent' } as const, [])
const draft = atom({ plugin: 'pr-comments', key: 'draft' } as const, null)
const at = atom({ plugin: 'pr-comments', key: 'at' } as const, 0)
const marked = atom({ plugin: 'pr-comments', key: 'marked' } as const, [])
const reply = atom({ plugin: 'pr-comments', key: 'reply' } as const, null)
const busy = atom({ plugin: 'pr-comments', key: 'busy' } as const, null)
const armed = atom({ plugin: 'pr-comments', key: 'armed' } as const, false)
// GitHub allows 5000 GraphQL points an hour; one poll costs a few.
const POLL_MS = 60_000

const exec = async ($: EngineInterface, argv: string[]) =>
  $.process.run(argv, { cwd: await $.session.cwd() }).catch(() => undefined)

const run = async ($: EngineInterface, argv: string[]) => {
  const r = await exec($, argv)
  return r && r.exitCode === 0 ? r.stdout.trim() : undefined
}

// What gh says outside a GitHub repo, as opposed to a failed call (network,
// auth), after which the band is kept. git's own words are translated,
// gh's are not.
const NO_REPO = /failed to run git|none of the git remotes/

const poll = async ($: EngineInterface) => {
  const head = (await run($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'])) ?? ''
  const r = await exec($, ['gh', 'api', 'graphql', '-F', `mine=${MINE}`, '-F', 'owner={owner}', '-F', 'repo={repo}', '-f', `branch=${head}`, '-f', `query=${QUERY}`])
  if (!r) return
  if (r.exitCode !== 0) return NO_REPO.test(r.stderr) ? update($, prs, () => []) : undefined
  try {
    const found = toPrs(JSON.parse(r.stdout))
    const known = new Set((await read($, prs)).flatMap(p => p.threads.map(t => t.id)))
    await update($, branch, () => head)
    await update($, prs, () => found)
    // A thread not seen before arms `c` until the next prompt is sent, so a
    // message starting with c is only caught right after threads come in.
    if (found.some(p => p.threads.some(t => !known.has(t.id)))) await update($, armed, () => true)
  } catch {
    // Not JSON: kept as it was, like a blip.
  }
}

// One poll at a time; one asked for meanwhile (a write's reload) runs once
// the current one ends, so it reads what the write did.
let isPolling = false
let isAskedAgain = false
let timer: Timer | undefined
const tick = async ($: EngineInterface) => {
  if (isPolling) {
    isAskedAgain = true
    return
  }
  isPolling = true
  do {
    isAskedAgain = false
    await poll($).catch(() => undefined)
  } while (isAskedAgain)
  isPolling = false
}

// The PR the pane shows: the one picked, else the first (the current
// branch's when it has threads), as PRs come and go.
const pane = async ($: EngineInterface): Promise<Pr | undefined> => {
  const list = await read($, prs)
  const picked = await read($, shownPr)
  return list.find(p => p.number === picked) ?? list[0]
}

const threads = async ($: EngineInterface) => (await pane($))?.threads ?? []

// The thread the pane shows, its index kept in range as threads resolve.
const current = async ($: EngineInterface): Promise<Thread | undefined> => {
  const list = await threads($)
  return list[Math.min(await read($, at), list.length - 1)]
}

const openPane = async ($: EngineInterface) => {
  if (!(await pane($))) return false
  await $.ui.open({ id: PANE, title: 'Review', focus: true, closeOnEscape: true, rows: 32 })
  return true
}

const showPr = async ($: EngineInterface, number: number) => {
  await update($, shownPr, () => number)
  await update($, at, () => 0)
  await update($, marked, () => [])
  await update($, reply, () => null)
}

// The next PR in the list, round to the first.
const nextPr = async ($: EngineInterface) => {
  const list = await read($, prs)
  const p = await pane($)
  // By number: each read of the state is a copy of its own.
  if (list.length > 1 && p) await showPr($, list[(list.findIndex(x => x.number === p.number) + 1) % list.length]!.number)
}

const go = async ($: EngineInterface, d: number) => {
  const last = (await threads($)).length - 1
  await update($, reply, () => null)
  await update($, at, n => Math.max(0, Math.min(last, n + d)))
}

const toggleMark = async ($: EngineInterface) => {
  const t = await current($)
  if (t) await update($, marked, ids => (ids.includes(t.id) ? ids.filter(id => id !== t.id) : [...ids, t.id]))
}

// Every thread marked, or none once they all are.
const toggleAll = async ($: EngineInterface) => {
  const ids = (await threads($)).map(t => t.id)
  await update($, marked, m => (ids.every(id => m.includes(id)) ? [] : ids))
}

// The marked threads, or the one shown, as a prompt in the box to read and
// send; they are badged sent only once that prompt is.
const fix = async ($: EngineInterface) => {
  const p = await pane($)
  const ids = await read($, marked)
  const shown = await current($)
  const chosen = ids.length ? (p?.threads ?? []).filter(t => ids.includes(t.id)) : shown ? [shown] : []
  if (!p || chosen.length === 0) return
  await update($, draft, () => ({ header: reviewHeader(p, chosen.length), ids: chosen.map(t => t.id) }))
  await update($, marked, () => [])
  await update($, reply, () => null)
  await $.ui.close({ id: PANE })
  await $.prompt.fill({ text: reviewPrompt(p, chosen, await read($, branch)) })
}

const startReply = async ($: EngineInterface) => {
  await update($, reply, () => '')
  // The field draws autoFocus too: a refused move still leaves it usable.
  await $.ui.focus({ requestId: PANE, key: 'reply' }).catch(() => undefined)
}

// Runs one GitHub write with the pane showing it, then reloads the threads.
const write = async ($: EngineInterface, label: string, argv: string[], done: string) => {
  await update($, busy, () => label)
  const out = await run($, argv)
  await update($, busy, () => null)
  if (out === undefined) return $.ui.toast(`✗ ${label} : échec (gh)`)
  $.ui.toast(done)
  await tick($)
}

// Enter on an empty field gives up the reply, as Esc does.
const postReply = async ($: EngineInterface, body: string) => {
  const t = await current($)
  await update($, reply, () => null)
  if (!t || !body.trim()) return
  await write($, 'publication de la réponse', ['gh', 'api', 'graphql', '-f', `query=${REPLY}`, '-f', `id=${t.id}`, '-f', `body=${body.trim()}`], `↩ réponse publiée sur ${where(t)}`)
}

const resolve = async ($: EngineInterface) => {
  const t = await current($)
  if (t) await write($, 'résolution du fil', ['gh', 'api', 'graphql', '-f', `query=${RESOLVE}`, '-f', `id=${t.id}`], `✓ fil résolu : ${where(t)}`)
}

// Markdown and Code take 10000 characters, tab and newline the only controls.
const clean = (text: string) => text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, 10_000)

// `fermer` while replying gives up the reply, as Esc does; else it closes.
// The plugin's own close skips its own ui.close hook, hence here.
const closeOrCancel = async ($: EngineInterface) => {
  if ((await read($, reply)) === null) return $.ui.close({ id: PANE })
  await update($, reply, () => null)
}

const openWeb = async ($: EngineInterface) => {
  const t = await current($)
  if (t) await run($, ['xdg-open', t.url])
}

const count = (p: Pr) => `#${p.number} (${p.threads.length})`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    void tick($)
    timer?.cancel()
    timer = $.clock.every(POLL_MS, () => void tick($))
    // `/review` is the built-in /code-review's; a refused name still leaves
    // the band and `c`.
    await $.command
      .register({ name: 'pr-review', description: 'Open the review threads of your PRs (or PR <number>) in a pane', argumentHint: '[number]' })
      .catch(() => $.ui.toast('pr-comments : /pr-review indisponible, utilise c'))
    return r
  })

  on('command.run', { command: 'pr-review' }, async ($, e) => {
    const number = Number(e.args.trim().replace(/^#/, ''))
    if (number) {
      if (!(await read($, prs)).some(p => p.number === number))
        return { text: `PR #${number} : aucun fil non résolu, ou ni à toi ni sur la branche courante.` }
      await showPr($, number)
    }
    return { text: (await openPane($)) ? 'Review ouverte.' : 'Aucun fil de review non résolu sur tes PR ni sur la branche courante.' }
  })

  // A letter typed at the prompt never presses a band Button: `c`, in an
  // empty prompt while armed, opens the pane; otherwise /pr-review.
  // Opened once the keystroke is done: the pane only gets the keyboard over
  // an empty prompt, and during the edit the prompt is still taking it.
  on('prompt.edit', async ($, e, next) => {
    if (e.text !== '' || e.inputText.toLowerCase() !== 'c' || !(await read($, armed)) || !(await pane($))) return next(e)
    $.clock.after(0, () => void openPane($))
    return { text: '', cursor: 0 }
  })

  // Esc while replying gives up the reply and keeps the pane: the close is
  // refused, and the pane asks back the keyboard Esc handed over.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'person' || (await read($, reply)) === null) return next(e)
    await update($, reply, () => null)
    $.clock.after(0, () => void openPane($))
    return { value: undefined }
  })

  // The prepared prompt sent, edited or not, badges its threads; the box
  // emptied or retyped does not. Any submit spends the draft, and disarms `c`.
  on('prompt.submit', async ($, e, next) => {
    await update($, armed, () => false)
    const d = await read($, draft)
    if (d) {
      await update($, draft, () => null)
      if (e.text.includes(d.header)) await update($, sent, ids => [...ids, ...d.ids])
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const list = await read($, prs)
    if (e.props.hasSurvey || list.length === 0) return below
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
        <Box>
          <Text color="yellow" wrap="truncate-end">
            💬 review non résolue : {list.map(count).join(' · ')} ·{' '}
          </Text>
          <Button key="open" label="ouvrir" hotkey="c" plain onPress={() => void openPane($)} />
          <Text dimColor>{(await read($, armed)) ? ' (c, prompt vide)' : ' (/pr-review)'}</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code, Markdown, Link } = $.ui.resolve(e)
    // Mobile draws no text field: no reply there, the rest works.
    const Input = e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input
    const all = await read($, prs)
    const p = await pane($)
    const list = p?.threads ?? []
    if (!p || list.length === 0) return <Text dimColor>Plus aucun fil non résolu. Esc pour fermer.</Text>
    const i = Math.min(await read($, at), list.length - 1)
    const t = list[i]!
    const head = await read($, branch)
    const sentIds = await read($, sent)
    const marks = await read($, marked)
    const replyText = await read($, reply)
    const running = await read($, busy)
    const hunk = hunkTail(t.hunk)
    const badges = (x: Thread) =>
      [x.isOutdated && 'obsolète', x.isAnswered && '↩ répondu', sentIds.includes(x.id) && '→ Claude'].filter(Boolean).join(' · ')

    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text bold>PR #{p.number}</Text> {p.title}
          <Text dimColor> · {p.branch === head ? 'branche courante' : p.branch}</Text>
        </Text>
        {all.length > 1 && (
          <Text wrap="truncate-end" dimColor>
            {all.map(x => (x.number === p.number ? `[${count(x)}]` : count(x))).join('  ')}
          </Text>
        )}
        {list.map((x, n) => (
          <Text wrap="truncate-end" color={n === i ? 'cyan' : undefined} dimColor={n !== i && x.isAnswered}>
            {n === i ? '▸' : ' '} {marks.includes(x.id) ? '◉' : ' '} {n + 1}. {where(x)}
            <Text dimColor> {badges(x)}</Text>
          </Text>
        ))}
        <Text dimColor>{'─'.repeat(Math.max(10, e.props.bodyColumns - 2))}</Text>
        <Box>
          <Text bold>{where(t)} </Text>
          <Link href={t.url} label="↗ GitHub" />
        </Box>
        {hunk ? <Code format="diff" source={clean(hunk)} path={t.path} /> : null}
        {t.comments.map(c => (
          <Box flexDirection="column" marginTop={1}>
            <Text color="yellow">@{c.author}</Text>
            <Markdown text={clean(c.body)} />
          </Box>
        ))}
        {replyText !== null && Input && (
          <Box marginTop={1}>
            <Input key="reply" label="Réponse : " value={replyText} submitLabel="publier" autoFocus onSubmit={(v: string) => void postReply($, v)} />
          </Box>
        )}
        {replyText !== null && (
          <Text dimColor>Entrée publie · Esc annule la réponse · les touches n, p… tapent dans le champ</Text>
        )}
        {running ? <Text color="cyan">… {running}</Text> : null}
        {!e.props.isFocused && (
          <Text color="yellow">Le panneau n'a pas le clavier : ctrl+x tab ou un clic, et les touches marchent.</Text>
        )}
        <Box marginTop={1} flexWrap="wrap">
          <Button key="prev" label="préc." hotkey="p" plain onPress={() => void go($, -1)} />
          <Text> </Text>
          <Button key="next" label="suiv." hotkey="n" plain onPress={() => void go($, 1)} />
          <Text> </Text>
          {all.length > 1 && <Button key="pr" label="PR suiv." hotkey="t" plain onPress={() => void nextPr($)} />}
          {all.length > 1 && <Text> </Text>}
          <Button key="mark" label={marks.includes(t.id) ? 'démarquer' : 'marquer'} hotkey="x" plain onPress={() => void toggleMark($)} />
          <Text> </Text>
          <Button key="all" label={marks.length === list.length ? 'tout démarquer' : 'tout marquer'} hotkey="a" plain onPress={() => void toggleAll($)} />
          <Text> </Text>
          <Button key="fix" label={marks.length ? `corriger (${marks.length})` : 'corriger'} hotkey="f" plain onPress={() => void fix($)} />
          <Text> </Text>
          <Button key="answer" label="répondre" hotkey="r" plain onPress={() => void startReply($)} />
          <Text> </Text>
          <Button key="resolve" label="résoudre" hotkey="v" plain onPress={() => void resolve($)} />
          <Text> </Text>
          <Button key="web" label="web" hotkey="o" plain onPress={() => void openWeb($)} />
          <Text> </Text>
          <Button key="close" label="fermer" hotkey="q" plain role="dismiss" onPress={() => void closeOrCancel($)} />
        </Box>
      </Box>
    )
  })
}
