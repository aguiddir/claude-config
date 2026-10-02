import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Pr, Thread } from '../types'
import { DETAIL, LIST, MINE, REPLY, RESOLVE, REQUESTED, REVIEWED, hunkTail, reviewHeader, reviewPrompt, toEntries, toThreads, where } from './threads'

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
// GitHub allows 5000 GraphQL points an hour: the list costs 1, and so does
// each changed PR's threads.
const POLL_MS = 60_000
// ponytail: every tenth poll asks all threads again, in case a thread
// resolved by someone else leaves the PR's updatedAt as it was.
const REFRESH_EVERY = 10

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

// Each PR's threads as last asked, by number, with the updatedAt they were
// asked at; a module's own, so a reload asks them all once.
const details = new Map<number, { updatedAt: string; threads: Thread[] }>()
// PRs this session wrote to, asked again at the next poll; written counts
// each PR's writes, so an ask clears the mark only if no write landed
// while it ran (its answer may predate that write).
const stale = new Set<number>()
const written = new Map<number, number>()
let polls = 0

const poll = async ($: EngineInterface) => {
  const head = (await run($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'])) ?? ''
  const r = await exec($, [
    'gh', 'api', 'graphql', '-F', `mine=${MINE}`, '-F', `requested=${REQUESTED}`, '-F', `reviewed=${REVIEWED}`,
    '-F', 'owner={owner}', '-F', 'repo={repo}', '-f', `branch=${head}`, '-f', `query=${LIST}`,
  ])
  if (!r) return
  if (r.exitCode !== 0) return NO_REPO.test(r.stderr) ? update($, prs, () => []) : undefined
  let entries
  try {
    entries = toEntries(JSON.parse(r.stdout))
  } catch {
    // Not JSON: kept as it was, like a blip.
    return
  }
  const isRefresh = polls++ % REFRESH_EVERY === 0
  for (const e of entries) {
    const known = details.get(e.number)
    if (known && known.updatedAt === e.updatedAt && !stale.has(e.number) && !isRefresh) continue
    const writesBefore = written.get(e.number)
    const out = await run($, ['gh', 'api', 'graphql', '-F', 'owner={owner}', '-F', 'repo={repo}', '-F', `n=${e.number}`, '-f', `query=${DETAIL}`])
    try {
      const asked = out === undefined ? undefined : toThreads(JSON.parse(out))
      // A failed ask keeps what was known, marked to be asked again next
      // poll, a refresh's too.
      if (asked) {
        details.set(e.number, { updatedAt: e.updatedAt, threads: asked })
        if (written.get(e.number) === writesBefore) stale.delete(e.number)
      } else stale.add(e.number)
    } catch {
      // Not JSON: as a failed ask.
      stale.add(e.number)
    }
  }
  // A PR whose threads could not be asked keeps those on screen, as after a
  // reload, which empties `details` but not the state: a failed ask never
  // takes a PR off the band, nor makes its threads look new.
  const before = await read($, prs)
  const shown = new Map(before.map(p => [p.number, p.threads]))
  const found: Pr[] = entries
    .map(({ updatedAt, ...e }) => ({ ...e, threads: details.get(e.number)?.threads ?? shown.get(e.number) ?? [] }))
    .filter(p => p.threads.length > 0)
  const seen = new Set(before.flatMap(p => p.threads.map(t => t.id)))
  await update($, branch, () => head)
  await update($, prs, () => found)
  // A thread not seen before arms `c` until the next prompt is sent, so a
  // message starting with c is only caught right after threads come in.
  if (found.some(p => p.threads.some(t => !seen.has(t.id)))) await update($, armed, () => true)
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

// Runs one GitHub write with the pane showing it, then reloads the threads,
// the written PR's asked again whatever its updatedAt says. Marked once
// the write is done, and counted, so that no ask begun before it clears
// the mark with an answer that predates it.
const write = async ($: EngineInterface, label: string, argv: string[], done: string) => {
  const p = await pane($)
  await update($, busy, () => label)
  const out = await run($, argv)
  await update($, busy, () => null)
  if (out === undefined) return $.ui.toast(`✗ ${label} : échec (gh)`)
  if (p) {
    stale.add(p.number)
    written.set(p.number, (written.get(p.number) ?? 0) + 1)
  }
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

// `à traiter : #89 (9) · en relecture : #73 (10)`, an empty group left out.
const groups = (list: readonly Pr[]) => {
  const todo = list.filter(p => !p.isReview).map(count)
  const review = list.filter(p => p.isReview).map(count)
  return [todo.length > 0 && `à traiter : ${todo.join(' · ')}`, review.length > 0 && `en relecture : ${review.join(' · ')}`]
    .filter(Boolean)
    .join(' · ')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    void tick($)
    timer?.cancel()
    timer = $.clock.every(POLL_MS, () => void tick($))
    // `/review` is the built-in /code-review's; a refused name still leaves
    // the band and `c`.
    await $.command
      .register({ name: 'pr-review', description: 'Open the review threads of your PRs and those you review (or PR <number>) in a pane', argumentHint: '[number]' })
      .catch(() => $.ui.toast('pr-comments : /pr-review indisponible, utilise c'))
    return r
  })

  on('command.run', { command: 'pr-review' }, async ($, e) => {
    const number = Number(e.args.trim().replace(/^#/, ''))
    if (number) {
      if (!(await read($, prs)).some(p => p.number === number))
        return { text: `PR #${number} : aucun fil non résolu, ou ni à toi, ni en relecture, ni sur la branche courante.` }
      await showPr($, number)
    }
    return { text: (await openPane($)) ? 'Review ouverte.' : 'Aucun fil de review non résolu sur tes PR, celles que tu relis ou la branche courante.' }
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
            💬 {groups(list)} ·{' '}
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
          <Text dimColor>
            {' · '}
            {p.isReview ? 'en relecture · ' : ''}
            {p.branch === head ? 'branche courante' : p.branch}
          </Text>
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
