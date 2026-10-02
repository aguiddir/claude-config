import { expect, mock, test } from 'claude-code/testing'

import { bar, jobUrl, minutes, repoOf, sonarKeyOf, toBuild, toGate } from '../hooks/jenkins'

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
const http = (body: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })

test('a running build fills the band, its end raises a toast', async ($, on) => {
  let isBuilding = true
  const toasts: string[] = []
  const clock = mock.clock(on)
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_$, e) =>
    proc(e.argv[1] === 'remote' ? 'git@github.com:softwarevidal/vidal-mcp.git' : e.argv[1] === 'rev-parse' ? 'main' : ''),
  )
  on('http.fetch', (_$, e) =>
    e.url.includes('wfapi')
      ? http({ stages: [{ name: 'Prepare', status: 'SUCCESS' }, { name: 'Build & Unit tests', status: isBuilding ? 'IN_PROGRESS' : 'FAILED' }] })
      : http({ number: 426, building: isBuilding, result: isBuilding ? null : 'FAILURE', timestamp: Date.now() - 60_000, estimatedDuration: 240_000, duration: 120_000 }),
  )
  on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }))
  const gateAsks: unknown[] = []
  on('tool.call', { tool: 'mcp__sonarqube__get_project_quality_gate_status' }, (_$, e) => {
    gateAsks.push(e)
    const text = JSON.stringify({ status: 'ERROR', conditions: [{ metricKey: 'new_coverage', status: 'ERROR', actualValue: '62.0', errorThreshold: '80' }] })
    return { result: text, text }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  // Beneath the band: an engine that draws nothing there.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  const band = () => $.ui.mount({ plugin: 'ci-watch', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } as never })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()

  const running = await band()
  expect(await running.find({ text: /● CI vidal-mcp · main #426/ })).toBeDefined()
  expect(await running.find({ text: /Build & Unit tests/ })).toBeDefined()
  await running.unmount()

  isBuilding = false
  await clock.advance(10_000)
  expect(toasts).toEqual(['✗ CI vidal-mcp · main #426 : FAILURE', '✗ Sonar vidal-mcp · main : quality gate en échec'])
  // No sonar-project.properties here: the repo name is the key, the branch the ref.
  expect(gateAsks[0]).toMatchObject({ projectKey: 'vidal-mcp', branch: 'main' })
  const done = await band()
  expect(await done.find({ text: /à l'étape Build & Unit tests/ })).toBeDefined()
  expect(await done.find({ text: /Sonar ✗ quality gate ERROR · new_coverage 62.0 \(seuil 80\)/ })).toBeDefined()
  await done.unmount()
})

test('/ci points the band at another repo', async ($, on) => {
  const cwds: string[] = []
  const clock = mock.clock(on)
  on('env.get', () => ({ value: '/home/me' }))
  on('session.cwd', () => ({ value: '/elsewhere' }))
  on('process.run', (_$, e) => (cwds.push(e.init?.cwd ?? ''), proc('')))
  const reply = await $.command.run({ command: 'ci', args: '~/PycharmProjects/data-bridge' } as never)
  expect(reply).toMatchObject({ text: 'CI suivie : /home/me/PycharmProjects/data-bridge' })
  await clock.settle()
  expect(cwds[0]).toBe('/home/me/PycharmProjects/data-bridge')
})
