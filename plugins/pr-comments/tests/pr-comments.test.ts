import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { cleanTitle, excerpt, hunkTail, reviewPrompt, shortWhere, toEntries, toThreads } from '../hooks/threads'

// Cut at the commented line, as GitHub sends it: the header counts more.
const HUNK = '@@ -10,8 +10,9 @@ def f():\n a\n+b\n c'
const node = (id: string, isResolved: boolean, body: string, reply?: string) => ({
  id, isResolved, isOutdated: false, path: 'app/a.py', line: 12,
  comments: {
    nodes: [
      { author: { login: 'bob' }, body, url: `https://gh/c/${id}`, diffHunk: HUNK },
      ...(reply ? [{ author: { login: 'me' }, body: reply, url: 'u', diffHunk: HUNK }] : []),
    ],
  },
})
const prJson = (number: number, branch: string, nodes: unknown[], author = 'me') => ({
  number, title: `PR ${number}`, url: `https://gh/pr/${number}`, headRefName: branch, author: { login: author }, reviewThreads: { nodes },
})
type PrDef = ReturnType<typeof prJson>
// What the list query answers: each PR without its threads, its updatedAt
// moving whenever they do.
const entry = (p: PrDef) => ({ number: p.number, title: p.title, url: p.url, headRefName: p.headRefName, updatedAt: JSON.stringify(p.reviewThreads) })
const listOf = (mine: PrDef[], here: PrDef[] = [], reviewing: PrDef[] = []) => ({
  data: {
    mine: { nodes: mine.map(entry) },
    requested: { nodes: reviewing.map(entry) },
    reviewed: { nodes: [] },
    repository: { pullRequests: { nodes: here.map(entry) } },
  },
})
// What the detail query answers for one PR.
const detailOf = (p: PrDef) => ({ data: { repository: { pullRequest: { author: p.author, reviewThreads: p.reviewThreads } } } })

test('unresolved threads, the author having the last word marked answered', async () => {
  const threads = toThreads(detailOf(prJson(7, 'feat/x', [node('a', false, 'renomme x', 'fait'), node('b', true, 'ok'), node('c', false, 'ajoute un test')])) as never)!
  expect(threads.map(t => [t.id, t.isAnswered])).toEqual([['a', true], ['c', false]])
  expect(threads[0]).toMatchObject({ url: 'https://gh/c/a', hunk: HUNK })
  const pr = { number: 7, isReview: false, title: 'PR 7', url: 'https://gh/pr/7', branch: 'feat/x', threads }
  expect(reviewPrompt(pr, threads.slice(0, 1), 'feat/x')).toBe(
    'Un fil de review de la PR #7 (https://gh/pr/7) :\n\napp/a.py:12\n@bob : renomme x\n@me : fait\n\nCorrige le code, ou dis-moi pourquoi tu ne le ferais pas.',
  )
  // From another branch, Claude is told to go to the PR's first.
  expect(reviewPrompt(pr, threads.slice(0, 1), 'main')).toContain("Ces fils portent sur la branche `feat/x`, pas sur la branche courante (`main`) : passe dessus avant de corriger (`gh pr checkout 7`")
  expect(toThreads({ data: { repository: { pullRequest: null } } })).toBeUndefined()
})

test("the current branch's PR first, then the user's, then those under review, each once", async () => {
  const other = prJson(9, 'feat/y', [], 'alice')
  // PR 9 is the current branch's and under review too: to work on, once.
  const list = toEntries(listOf([prJson(7, 'feat/x', [])], [other], [other, prJson(5, 'feat/v', [], 'carol')]) as never)
  expect(list.map(p => [p.number, p.isReview])).toEqual([[9, false], [7, false], [5, true]])
  expect(toEntries({ data: { mine: { nodes: [] }, repository: { pullRequests: { nodes: [] } } } })).toEqual([])
})

test('a thread by its file name, its folder only between twins; what it is about; a title without its tags', async () => {
  const t = (path: string, body = 'x') => ({ id: path, path, line: 3, isOutdated: false, url: '', hunk: '', comments: [{ author: 'a', body }], isAnswered: false })
  const list = [t('a/detail/form.ts'), t('a/create/form.ts'), t('a/b/list.ts')]
  expect(list.map(x => shortWhere(x, list))).toEqual(['detail/form.ts:3', 'create/form.ts:3', 'list.ts:3'])
  expect(excerpt(t('f', '\n**Une modification** validée `pendant` une sauvegarde\nsuite'))).toBe('Une modification validée pendant une sauvegarde')
  expect(excerpt(t('f', 'x'.repeat(100)), 10)).toBe('xxxxxxxxx…')
  expect(excerpt(t('f', '> reçoit une List<String> brute'))).toBe('reçoit une List<String> brute')
  expect(cleanTitle('✨ POSO-75: Add RSM selection [DEPLOY_PR][poso75]')).toBe('✨ POSO-75: Add RSM selection')
})

test('a hunk keeps its last lines under a header counted from them', async () => {
  expect(hunkTail(HUNK)).toBe('@@ -10,2 +10,3 @@ def f():\n a\n+b\n c')
  // Cut after a removed and an added line: both starts move past them.
  expect(hunkTail('@@ -1,9 +1,9 @@\n-x\n+y\n a\n+b\n c', 3)).toBe('@@ -2,2 +2,3 @@\n a\n+b\n c')
  expect(hunkTail('not a hunk')).toBeUndefined()
})

const proc = (stdout: string, exitCode = 0, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})
const PANE_PROPS = { title: 'Review PR #7', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: {}, view: {} } as never

// A fake gh beneath the plugin: the PR's threads, and the writes it was asked.
const setUp = async ($: Engine, on: On) => {
  const world = {
    nodes: [node('a', false, 'renomme x'), node('b', false, 'ajoute un test', 'fait')],
    writes: [] as string[][],
    filled: [] as string[],
    opened: 0,
    closed: 0,
    // A failed list (exit code and stderr) instead of the PRs, and a list held
    // mid-poll.
    fail: null as null | { exitCode: number; stderr: string },
    head: 'feat/x',
    more: [] as PrDef[],
    reviewing: [] as PrDef[],
    // How many times each PR's threads were asked.
    details: {} as Record<number, number>,
    // GitHub leaving updatedAt alone (as a resolution may), a detail ask
    // that fails, and one held mid-poll.
    frozen: null as null | string,
    detailFails: false,
    detailHold: null as null | Promise<void>,
    detailHeld: () => {},
    hold: null as null | Promise<void>,
    held: () => {},
    wrote: () => {},
  }
  const clock = mock.clock(on)
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'git') return proc(world.head)
    const query = e.argv.find(a => a.startsWith('query='))!
    if (query.includes('mutation')) {
      world.writes.push(e.argv.filter(a => a.startsWith('id=') || a.startsWith('body=')))
      world.wrote()
      if (query.includes('resolveReviewThread')) world.nodes = world.nodes.filter(n => !e.argv.includes(`id=${n.id}`))
      return proc('{}')
    }
    const mine = [prJson(7, 'feat/x', world.nodes), ...world.more]
    if (query.includes('pullRequest(number')) {
      const n = Number(e.argv.find(a => a.startsWith('n='))!.slice(2))
      world.details[n] = (world.details[n] ?? 0) + 1
      if (world.detailFails) return proc('', 1, 'error connecting to api.github.com')
      // Read before any hold: a held ask answers what was true when it asked.
      const detail = JSON.stringify(detailOf([...mine, ...world.reviewing].find(p => p.number === n)!))
      if (world.detailHold) {
        world.detailHeld()
        await world.detailHold
      }
      return proc(detail)
    }
    if (world.fail) return proc('', world.fail.exitCode, world.fail.stderr)
    // Read before any hold: a held poll answers what was true when it asked.
    const list = listOf(mine, [], world.reviewing)
    if (world.frozen) list.data.mine.nodes.forEach(n => (n.updatedAt = world.frozen!))
    const answer = JSON.stringify(list)
    if (world.hold) {
      world.held()
      await world.hold
    }
    return proc(answer)
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('prompt.fill', (_$, e) => (world.filled.push(e.text), { isFilled: true }))
  on('prompt.edit', (_$, e) => ({ text: e.text + e.inputText, cursor: e.cursor + e.inputText.length }))
  on('ui.open', () => (world.opened++, { value: { isPlaced: true } }) as never)
  on('ui.close', () => (world.closed++, { value: undefined }) as never)
  on('ui.focus', () => ({ value: { isFocused: true } }) as never)
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const pane = () => $.ui.mount({ plugin: 'pr-comments', surface: 'terminal', component: 'Pane', requestId: 'pr-review', props: PANE_PROPS })
  return { world, clock, pane }
}

// The kit's typings leave prompt.edit off the test's $, though it runs it.
const typeKey = ($: Engine, text: string, key: string) =>
  ($.prompt as unknown as { edit: (e: unknown) => Promise<{ text: string }> }).edit({
    origin: { kind: 'composer' }, text, cursor: text.length, start: text.length, end: text.length, inputText: key,
  })

test('c opens the pane; n walks the threads, each with its code and conversation', async ($, on) => {
  const ctx = await setUp($, on)
  const { world, pane } = ctx
  const band = await $.ui.mount({ plugin: 'pr-comments', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } as never })
  expect(await band.find({ text: /à traiter #7 \(2\)/ })).toBeDefined()
  await band.unmount()
  expect(await typeKey($, 'un ', 'c')).toMatchObject({ text: 'un c' })
  const { clock } = ctx
  expect(await typeKey($, '', 'c')).toMatchObject({ text: '' })
  // Opened once the keystroke is done.
  expect(world.opened).toBe(0)
  await clock.settle()
  expect(world.opened).toBe(1)

  const ui = await pane()
  expect(await ui.find({ text: /▸  1 a\.py:12/ })).toBeDefined()
  expect(await ui.find({ text: /↩ répondu/ })).toBeDefined()
  expect(await ui.find({ text: /renomme x/ })).toBeDefined()
  await ui.press({ key: 'next' })
  expect(await ui.find({ text: /▸  2 a\.py:12/ })).toBeDefined()
  expect(await ui.find({ text: /ajoute un test/ })).toBeDefined()
  await ui.press({ key: 'close' })
  expect(world.closed).toBe(1)
  await ui.unmount()
})

test('x marks threads and f puts them in the box; sending it badges them', async ($, on) => {
  const { world, pane } = await setUp($, on)
  const ui = await pane()
  await ui.press({ key: 'mark' })
  await ui.press({ key: 'next' })
  await ui.press({ key: 'mark' })
  expect(await ui.find({ text: /corriger \(2\)/ })).toBeDefined()
  await ui.press({ key: 'fix' })
  expect(world.closed).toBe(1)
  expect(world.filled[0]).toMatch(/^2 fils de review de la PR #7/)
  // a marks them all, and again none.
  await ui.press({ key: 'all' })
  expect(await ui.find({ text: /corriger \(2\)/ })).toBeDefined()
  expect(await ui.find({ text: /tout démarquer/ })).toBeDefined()
  await ui.press({ key: 'all' })
  expect(await ui.find({ text: /corriger \(/ })).toBeUndefined()
  expect(world.filled[0]).toContain('renomme x')
  expect(world.filled[0]).toContain('ajoute un test')
  await $.prompt.submit({ text: world.filled[0]! } as never)
  expect(await ui.find({ text: /→ Claude/ })).toBeDefined()
  await ui.unmount()
})

test('r writes a reply posted to GitHub, Esc or an empty Enter gives it up, v resolves the thread', async ($, on) => {
  const { world, pane } = await setUp($, on)
  const ui = await pane()
  await ui.press({ key: 'answer' })
  await ui.input({ key: 'reply', text: 'Bonne idée, fait.' })
  expect(world.writes[0]).toEqual(['id=a', 'body=Bonne idée, fait.'])

  // Enter on an emptied field gives up the reply, posting nothing.
  await ui.press({ key: 'answer' })
  await ui.input({ key: 'reply', text: '' })
  expect(world.writes).toHaveLength(1)
  expect(await ui.find({ key: 'reply' })).toBeUndefined()

  // `fermer` while replying gives up the reply and keeps the pane, as Esc
  // does (a close the kit cannot raise as the person's); again, it closes.
  await ui.press({ key: 'answer' })
  await ui.press({ key: 'close' })
  expect(await ui.find({ key: 'reply' })).toBeUndefined()
  expect(world.closed).toBe(0)
  await ui.press({ key: 'close' })
  expect(world.closed).toBe(1)

  await ui.press({ key: 'resolve' })
  expect(world.writes[1]).toEqual(['id=a'])
  // Reloaded: the resolved thread is gone, the next one shown.
  expect(await ui.find({ text: /▸  1 a\.py:12/ })).toBeDefined()
  expect(await ui.find({ text: /ajoute un test/ })).toBeDefined()
  expect(await ui.find({ text: /renomme x/ })).toBeUndefined()
  await ui.unmount()
})

test('c is caught from new threads to the next prompt sent, then is a letter', async ($, on) => {
  const { world, clock } = await setUp($, on)
  await $.prompt.submit({ text: 'autre chose' } as never)
  expect(await typeKey($, '', 'c')).toMatchObject({ text: 'c' })
  await clock.settle()
  expect(world.opened).toBe(0)
  // A new thread arms it again.
  world.nodes = [...world.nodes, node('c', false, 'et ici ?')]
  await clock.advance(60_000)
  expect(await typeKey($, '', 'c')).toMatchObject({ text: '' })
  await clock.settle()
  expect(world.opened).toBe(1)
})

test('a failed query keeps the band; outside a GitHub repo clears it', async ($, on) => {
  const { world, clock } = await setUp($, on)
  const band = async () => {
    const ui = await $.ui.mount({ plugin: 'pr-comments', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } as never })
    const found = await ui.find({ text: /à traiter #7 \(2\)/ })
    await ui.unmount()
    return found
  }
  expect(await band()).toBeDefined()
  world.fail = { exitCode: 1, stderr: 'error connecting to api.github.com' }
  await clock.advance(60_000)
  expect(await band()).toBeDefined()
  world.fail = { exitCode: 1, stderr: 'failed to run git: fatal : pas un dépôt git' }
  await clock.advance(60_000)
  expect(await band()).toBeUndefined()
})

test('from main: every PR of yours on the band, t to switch, f says which branch to go to', async ($, on) => {
  const { world, clock, pane } = await setUp($, on)
  world.head = 'main'
  world.more = [prJson(8, 'feat/w', [node('w', false, 'nomme mieux')])]
  await clock.advance(60_000)
  const band = await $.ui.mount({ plugin: 'pr-comments', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } as never })
  expect(await band.find({ text: /à traiter #7 \(2\) #8 \(1\)/ })).toBeDefined()
  await band.unmount()
  const ui = await pane()
  expect(await ui.find({ text: /branche feat\/x/ })).toBeDefined()
  await ui.press({ key: 'pr' })
  expect(await ui.find({ text: /PR #8 PR 8/ })).toBeDefined()
  expect(await ui.find({ text: /nomme mieux/ })).toBeDefined()
  await ui.press({ key: 'fix' })
  expect(world.filled[0]).toMatch(/^Un fil de review de la PR #8/)
  expect(world.filled[0]).toContain('passe dessus avant de corriger (`gh pr checkout 8`')
  await ui.unmount()
  // /pr-review 7 goes back to PR 7; a PR not listed is said so.
  expect(await $.command.run({ command: 'pr-review', args: '7' } as never)).toMatchObject({ text: 'Review ouverte.' })
  expect(await $.command.run({ command: 'pr-review', args: '#42' } as never)).toMatchObject({ text: expect.stringContaining('PR #42 : aucun fil') })
  const ui2 = await pane()
  expect(await ui2.find({ text: /PR #7 PR 7/ })).toBeDefined()
  await ui2.unmount()
})

test("a write during a poll still reloads after it, so a resolved thread leaves", async ($, on) => {
  const { world, clock, pane } = await setUp($, on)
  const ui = await pane()
  let release = () => {}
  world.hold = new Promise(r => (release = r))
  const isHeld = new Promise<void>(r => (world.held = r))
  // The minute's poll asks, and waits on GitHub.
  void clock.advance(60_000)
  await isHeld
  // Resolved on GitHub while that poll still holds the old list.
  const isWritten = new Promise<void>(r => (world.wrote = r))
  const resolving = ui.press({ key: 'resolve' })
  await isWritten
  world.hold = null
  release()
  await resolving
  await clock.settle()
  expect(await ui.find({ text: /renomme x/ })).toBeUndefined()
  await ui.unmount()
})

test('PRs under review form their own group on the band and say so in the pane', async ($, on) => {
  const { world, clock, pane } = await setUp($, on)
  world.reviewing = [prJson(73, 'feat/z', [node('q', false, 'pourquoi ce choix ?')], 'amercadal')]
  await clock.advance(60_000)
  const band = await $.ui.mount({ plugin: 'pr-comments', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } as never })
  expect(await band.find({ text: /à traiter #7 \(2\) · en relecture #73 \(1\)/ })).toBeDefined()
  await band.unmount()
  await $.command.run({ command: 'pr-review', args: '73' } as never)
  const ui = await pane()
  expect(await ui.find({ text: /en relecture ▸#73 \(1\)/ })).toBeDefined()
  await ui.unmount()
})

test("a PR's threads are asked only when it changed, after a write, or every tenth poll", async ($, on) => {
  const { world, clock, pane } = await setUp($, on)
  expect(world.details[7]).toBe(1)
  await clock.advance(60_000)
  expect(world.details[7]).toBe(1)
  // A new thread moves its updatedAt.
  world.nodes = [...world.nodes, node('c', false, 'et ici ?')]
  await clock.advance(60_000)
  expect(world.details[7]).toBe(2)
  // A reply leaves the list as it was, yet the written PR is asked again.
  const ui = await pane()
  await ui.press({ key: 'answer' })
  await ui.input({ key: 'reply', text: 'ok' })
  expect(world.details[7]).toBe(3)
  await ui.unmount()
  // Polls 4 to 10 ask nothing; the eleventh asks again whatever changed.
  for (let k = 0; k < 6; k++) await clock.advance(60_000)
  expect(world.details[7]).toBe(3)
  await clock.advance(60_000)
  expect(world.details[7]).toBe(4)
})

test("a write while a poll asks that PR's threads is read again after, updatedAt unmoved", async ($, on) => {
  const { world, clock, pane } = await setUp($, on)
  // A new thread makes the minute's poll ask PR 7; GitHub then leaves its
  // updatedAt where it is.
  world.nodes = [...world.nodes, node('c', false, 'et ici ?')]
  world.frozen = 'after'
  let release = () => {}
  world.detailHold = new Promise(r => (release = r))
  const isHeld = new Promise<void>(r => (world.detailHeld = r))
  void clock.advance(60_000)
  await isHeld
  // Resolved while that ask still holds the old threads.
  const ui = await pane()
  const isWritten = new Promise<void>(r => (world.wrote = r))
  const resolving = ui.press({ key: 'resolve' })
  await isWritten
  world.detailHold = null
  release()
  await resolving
  await clock.settle()
  expect(await ui.find({ text: /renomme x/ })).toBeUndefined()
  await ui.unmount()
})

test("a refresh poll's failed ask is asked again at the next poll", async ($, on) => {
  const { world, clock } = await setUp($, on)
  for (let k = 0; k < 9; k++) await clock.advance(60_000)
  expect(world.details[7]).toBe(1)
  // The tenth poll after the first is a refresh; its ask fails.
  world.detailFails = true
  await clock.advance(60_000)
  expect(world.details[7]).toBe(2)
  world.detailFails = false
  await clock.advance(60_000)
  expect(world.details[7]).toBe(3)
})

test("an ask begun before a write and answered after it does not clear the write's mark", async ($, on) => {
  const { world, clock, pane } = await setUp($, on)
  world.nodes = [...world.nodes, node('c', false, 'et ici ?')]
  world.frozen = 'after'
  let release = () => {}
  world.detailHold = new Promise(r => (release = r))
  const isHeld = new Promise<void>(r => (world.detailHeld = r))
  void clock.advance(60_000)
  await isHeld
  // The resolve is sent and done while that ask still waits on GitHub.
  const ui = await pane()
  await ui.press({ key: 'resolve' })
  expect(world.writes).toEqual([['id=a']])
  // Its answer, from before the resolve, comes in only now.
  world.detailHold = null
  release()
  await clock.settle()
  expect(await ui.find({ text: /renomme x/ })).toBeUndefined()
  await ui.unmount()
})
