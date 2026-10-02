import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { bar, errorLines, frameColor, jobUrl, live, minutes, repoOf, short, sonarKeyOf, toBuild, toGate } from '../hooks/jenkins'

test('repo, job URL and progress', async () => {
  expect(repoOf('git@github.com:softwarevidal/vidal-mcp.git')).toBe('vidal-mcp')
  expect(repoOf('https://github.com/softwarevidal/lycos')).toBe('lycos')
  expect(repoOf('git@github.com:aguiddir/claude-config.git')).toBeUndefined()
  expect(jobUrl('vidal-mcp', 'feat/x')).toBe('https://jenkins.vidal.net/job/team.software/job/github/job/vidal-mcp/job/feat%252Fx')
  expect(bar(50, 10)).toBe('█████░░░░░')
  expect(minutes(65_000)).toBe('1 min 05')

  const running = { number: 7, building: true, result: null, timestamp: 0, estimatedDuration: 400_000, duration: 0 }
  expect(toBuild('r · main', 'u', running, {}, 100_000)).toMatchObject({ percent: 25, remainingMs: 300_000, url: 'u/7/' })
  // Past the estimate it holds at 99 %, never 100 while running.
  expect(toBuild('r · main', 'u', running, {}, 900_000).percent).toBe(99)
  const done = { ...running, building: false, result: 'FAILURE', duration: 300_000 }
  expect(toBuild('r · main', 'u', done, {}, 900_000)).toMatchObject({ percent: 100, endedAt: 300_000 })
})

test('live clock, short durations and frame colour', async () => {
  expect(live({ startedAt: 0, estimatedMs: 200_000 }, 50_000)).toEqual({ elapsedMs: 50_000, percent: 25, remainingMs: 150_000 })
  expect(live({ startedAt: 0, estimatedMs: 0 }, 50_000)).toEqual({ elapsedMs: 50_000, percent: 0, remainingMs: 0 })
  expect(short(4_000)).toBe('4s')
  expect(short(72_000)).toBe('1m12')
  expect([frameColor(true, null), frameColor(false, 'SUCCESS'), frameColor(false, 'FAILURE'), frameColor(false, 'UNSTABLE')]).toEqual(['cyan', 'green', 'red', 'yellow'])
})

test('error lines: each with the line before, pipeline chatter left out, the last ones kept', async () => {
  const log = ['[Pipeline] sh', '+ pytest', 'tests/a.py:3: in test_x', 'AssertionError: 1 != 2', '[Pipeline] }', 'ERROR: script returned exit code 1', 'Stage "Deploy" skipped due to earlier failure(s)', '', 'Finished: FAILURE'].join('\n')
  expect(errorLines(log)).toBe('tests/a.py:3: in test_x\nAssertionError: 1 != 2\nERROR: script returned exit code 1')
  expect(errorLines(log, 2)).toBe('AssertionError: 1 != 2\nERROR: script returned exit code 1')
  // Nothing names an error: the end of the log.
  expect(errorLines('a\nb\nc', 2)).toBe('b\nc')
})

test('sonar key and quality gate', async () => {
  expect(sonarKeyOf('sonar.exclusions = a\nsonar.projectKey=vidal-mcp\n')).toBe('vidal-mcp')
  expect(sonarKeyOf('sonar.sources=.')).toBeUndefined()
  const gate = toGate({
    status: 'ERROR',
    conditions: [
      { metricKey: 'new_coverage', status: 'ERROR', actualValue: '62.0', errorThreshold: '80' },
      { metricKey: 'new_violations', status: 'OK', actualValue: '0', errorThreshold: '0' },
    ],
  })
  expect(gate).toEqual({ status: 'ERROR', failed: [{ metric: 'new_coverage', actual: '62.0', threshold: '80' }] })
})

const proc = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})
const http = (body: unknown, status = 200) => ({
  value: { status, ok: status < 400, headers: {}, text: JSON.stringify(body) },
})
const GATE_RED = JSON.stringify({ status: 'ERROR', conditions: [{ metricKey: 'new_coverage', status: 'ERROR', actualValue: '62.0', errorThreshold: '80' }] })

// A fake Jenkins, git, gh and Sonar beneath the plugin, driven by `world`.
const setUp = ($: Engine, on: On) => {
  const world = {
    run: { number: 426, building: true, result: null as string | null, timestamp: Date.now() - 60_000, estimatedDuration: 240_000, duration: 0 },
    stages: [{ name: 'Prepare', status: 'SUCCESS', durationMillis: 4_000 }, { name: 'SonarQube', status: 'IN_PROGRESS', durationMillis: 9_000 }],
    branchJob: true,
    jenkinsDown: false,
    gh: 0,
    cwds: [] as string[],
    gateAsks: [] as unknown[],
    toasts: [] as string[],
    prompts: [] as string[],
    consoleReads: 0,
    contexts: [] as (readonly string[] | undefined)[],
    filled: [] as string[],
  }
  const clock = mock.clock(on)
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('env.get', () => ({ value: '/home/me' }))
  on('process.run', (_$, e) => {
    world.cwds.push(e.init?.cwd ?? '')
    if (e.argv[0] === 'gh') return (world.gh++, proc('233'))
    return proc(e.argv[1] === 'remote' ? 'git@github.com:softwarevidal/vidal-mcp.git' : e.argv[1] === 'rev-parse' ? 'main' : '')
  })
  on('http.fetch', (_$, e) => {
    if (world.jenkinsDown) return http({}, 503)
    if (!world.branchJob && e.url.includes('/job/main/')) return http({}, 404)
    if (e.url.endsWith('consoleText')) return world.consoleReads++, { value: { status: 200, ok: true, headers: {}, text: 'checkout\n'.repeat(300) + 'AssertionError: 1 != 2\n' } }
    return e.url.includes('wfapi') ? http({ stages: world.stages }) : http(world.run)
  })
  on('tool.call', { tool: 'mcp__sonarqube__get_project_quality_gate_status' }, (_$, e) => {
    world.gateAsks.push(e)
    return { result: GATE_RED, text: GATE_RED }
  })
  on('prompt.submit', (_$, e) => (world.prompts.push(e.text), world.contexts.push(e.context), { text: e.text }))
  on('prompt.fill', (_$, e) => (world.filled.push(e.text), { isFilled: true }))
  on('prompt.edit', (_$, e) => ({ text: e.text + e.inputText, cursor: e.cursor + e.inputText.length }))
  on('ui.toast', (_$, e) => (world.toasts.push(e.text), { value: undefined }))
  // Beneath the band: an engine that draws nothing there.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  const band = async (text: RegExp) => {
    const ui = await $.ui.mount({ plugin: 'ci-watch', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } as never })
    const found = await ui.find({ text })
    await ui.unmount()
    return found
  }
  const end = (result: string, endedAgoMs: number, sonar = 'SUCCESS') => {
    world.run = { ...world.run, building: false, result, timestamp: Date.now() - endedAgoMs - 100_000, duration: 100_000 }
    world.stages = [{ name: 'Prepare', status: 'SUCCESS', durationMillis: 4_000 }, { name: 'SonarQube', status: sonar, durationMillis: 72_000 }]
  }
  const start = async () => {
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await clock.settle()
  }
  return { world, clock, band, end, start }
}

test('a running build fills the band; its end toasts the result, then the red gate once settled', async ($, on) => {
  const { world, clock, band, end, start } = setUp($, on)
  await start()
  expect(await band(/● CI vidal-mcp · main #426/)).toBeDefined()
  // A finished stage shows its time, the running one does not yet.
  expect(await band(/✓ Prepare 4s {2}● SonarQube {2}/)).toBeDefined()
  expect(await band(/ouvrir le build #426 dans Jenkins/)).toBeDefined()
  // The branch has its own job: gh is never asked for the PR.
  expect(world.gh).toBe(0)

  end('FAILURE', 5_000)
  await clock.advance(10_000)
  expect(world.toasts).toEqual(['✗ CI vidal-mcp · main #426 : FAILURE'])
  // Too soon after the end for the gate to be this build's.
  expect(world.gateAsks).toHaveLength(0)

  end('FAILURE', 40_000)
  await clock.advance(10_000)
  expect(world.gateAsks[0]).toMatchObject({ projectKey: 'vidal-mcp', branch: 'main' })
  expect(world.toasts[1]).toBe('✗ Sonar vidal-mcp · main : quality gate en échec')
  expect(await band(/Sonar ✗ quality gate ERROR · new_coverage 62.0 \(seuil 80\)/)).toBeDefined()
  await clock.advance(10_000)
  expect(world.toasts).toHaveLength(2)
})

test('a Jenkins blip keeps the band, so the end is still toasted', async ($, on) => {
  const { world, clock, band, end, start } = setUp($, on)
  await start()
  world.jenkinsDown = true
  await clock.advance(10_000)
  expect(await band(/#426/)).toBeDefined()
  end('SUCCESS', 1_000)
  world.jenkinsDown = false
  await clock.advance(10_000)
  expect(world.toasts).toEqual(['✓ CI vidal-mcp · main #426 : SUCCESS'])
})

test('an old red gate seen at start is not toasted, and is read once', async ($, on) => {
  const { world, clock, end, start } = setUp($, on)
  end('SUCCESS', 3 * 3_600_000)
  await start()
  await clock.advance(30_000)
  expect(world.toasts).toEqual([])
  expect(world.gateAsks).toHaveLength(1)
})

test('a build that failed before its Sonar stage shows no gate', async ($, on) => {
  const { world, clock, end, start } = setUp($, on)
  await start()
  end('FAILURE', 40_000, 'NOT_EXECUTED')
  await clock.advance(10_000)
  expect(world.gateAsks).toHaveLength(0)
  expect(world.toasts).toEqual(['✗ CI vidal-mcp · main #426 : FAILURE'])
})

test('without a branch job, the PR job is followed and its gate read by PR', async ($, on) => {
  const { world, clock, band, end, start } = setUp($, on)
  world.branchJob = false
  await start()
  expect(await band(/vidal-mcp · PR-233 #426/)).toBeDefined()
  end('SUCCESS', 40_000)
  await clock.advance(10_000)
  expect(world.gateAsks[0]).toMatchObject({ pullRequest: '233' })
})

test('/ci points the band at another repo', async ($, on) => {
  const { world, clock } = setUp($, on)
  const reply = await $.command.run({ command: 'ci', args: '~/PycharmProjects/data-bridge' } as never)
  expect(reply).toMatchObject({ text: 'CI suivie : /home/me/PycharmProjects/data-bridge' })
  await clock.settle()
  expect(world.cwds).toContain('/home/me/PycharmProjects/data-bridge')
})

test('f puts a broken build in the prompt box, with the end of its log and the red gate', async ($, on) => {
  const { world, clock, band, end, start } = setUp($, on)
  // The kit's typings leave prompt.edit off the test's $, though it runs it.
  const prompt = $.prompt as unknown as { edit: (e: unknown) => Promise<{ text: string }> }
  const typeKey = (text: string, key: string) =>
    prompt.edit({ origin: { kind: 'composer' }, text, cursor: text.length, start: text.length, end: text.length, inputText: key })
  await start()
  // While it runs, f is just a letter.
  expect(await typeKey('', 'f')).toMatchObject({ text: 'f' })
  expect(await band(/préparer le prompt/)).toBeUndefined()

  end('FAILURE', 40_000)
  world.stages.push({ name: 'Deploy', status: 'FAILED', durationMillis: 1_000 })
  await clock.advance(10_000)
  expect(await band(/préparer le prompt de correction/)).toBeDefined()
  // Mid-sentence, f stays a letter.
  expect(await typeKey('le ', 'f')).toMatchObject({ text: 'le f' })
  const sent = (await typeKey('', 'f')).text
  // In the box to read and send, not sent.
  expect(world.prompts).toEqual([])
  expect(sent).toContain("FAILURE à l'étape Deploy")
  // The box holds the error lines, not the console's end.
  expect(sent).toContain('checkout\nAssertionError: 1 != 2')
  expect(sent.split('checkout').length - 1).toBe(1)
  expect(sent).toContain('new_coverage 62.0 (seuil 80)')

  // The band's button fills the box the same way.
  const ui = await $.ui.mount({ plugin: 'ci-watch', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } as never })
  await ui.press({ key: 'fix' })
  await clock.settle()
  await ui.unmount()
  expect(world.filled).toEqual([sent])
  expect(world.prompts).toEqual([])

  // Sent as prepared, or edited: the log's end goes with it, once.
  await $.prompt.submit({ text: sent.replace('Trouve', 'Regarde le test puis trouve') } as never)
  expect(world.contexts[0]![0]).toMatch(/^Les dernières lignes du log Jenkins de vidal-mcp · main #426/)
  expect(world.contexts[0]![0]!.split('checkout').length - 1).toBe(149)
  await $.prompt.submit({ text: sent } as never)
  expect(world.contexts[1]).toBeUndefined()
  // Box retyped: nothing attached.
  const ui2 = await $.ui.mount({ plugin: 'ci-watch', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } as never })
  await ui2.press({ key: 'fix' })
  await ui2.unmount()
  await $.prompt.submit({ text: 'autre chose' } as never)
  expect(world.contexts[2]).toBeUndefined()
  // The console was read once, by the poll, never on a keystroke.
  expect(world.consoleReads).toBe(1)
})

test('once a prompt is sent, f is a letter again while the broken build stays on the band', async ($, on) => {
  const { world, clock, band, end, start } = setUp($, on)
  const prompt = $.prompt as unknown as { edit: (e: unknown) => Promise<{ text: string }> }
  const typeKey = (text: string, key: string) =>
    prompt.edit({ origin: { kind: 'composer' }, text, cursor: text.length, start: text.length, end: text.length, inputText: key })
  await start()
  end('FAILURE', 5_000)
  await clock.advance(10_000)
  await $.prompt.submit({ text: 'autre chose' } as never)
  await clock.advance(10_000)
  // "fix the tests" starts as typed, the button still offered.
  expect(await typeKey('', 'f')).toMatchObject({ text: 'f' })
  expect(await band(/préparer le prompt de correction \(ctrl\+x tab puis f\)/)).toBeDefined()
  expect(world.filled).toEqual([])
})
