import type { Pr, Thread } from '../types'

// Every poll, one light request lists the PRs to show: the user's open PRs
// in the repo and the current branch's whoever wrote it (to work on), and
// the PRs the user reviews, asked or already reviewed, as GitHub drops the
// request once a review is in. A PR's threads are then asked only when it
// changed (DETAIL): the threads with their comments cost about 30 times
// the list. `{owner}` and `{repo}` are filled in by `gh api` in -F fields only.
export const LIST = `query($mine: String!, $requested: String!, $reviewed: String!, $owner: String!, $repo: String!, $branch: String!) {
  viewer { login }
  mine: search(query: $mine, type: ISSUE, first: 20) { nodes { ...pr } }
  requested: search(query: $requested, type: ISSUE, first: 20) { nodes { ...pr } }
  reviewed: search(query: $reviewed, type: ISSUE, first: 20) { nodes { ...pr } }
  repository(owner: $owner, name: $repo) { pullRequests(headRefName: $branch, states: OPEN, first: 1) { nodes { ...pr } } } }
fragment pr on PullRequest { number title url headRefName updatedAt author { login } }`
export const MINE = 'repo:{owner}/{repo} is:pr is:open author:@me'
export const REQUESTED = 'repo:{owner}/{repo} is:pr is:open -author:@me review-requested:@me'
export const REVIEWED = 'repo:{owner}/{repo} is:pr is:open -author:@me reviewed-by:@me'

export const DETAIL = `query($owner: String!, $repo: String!, $n: Int!) {
  repository(owner: $owner, name: $repo) { pullRequest(number: $n) { author { login }
    reviewThreads(first: 100) { nodes { id isResolved isOutdated path line
      comments(first: 50) { nodes { author { login } body url diffHunk } } } } } } }`

export const REPLY = `mutation($id: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) { comment { id } } }`

export const RESOLVE = `mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id } } }`

type EntryJson = { number?: number; title: string; url: string; headRefName: string; updatedAt: string; author: { login: string } | null }
type ListJson = {
  data?: {
    viewer?: { login: string }
    mine?: { nodes: EntryJson[] }
    requested?: { nodes: EntryJson[] }
    reviewed?: { nodes: EntryJson[] }
    repository?: { pullRequests: { nodes: EntryJson[] } } | null
  }
}

// A PR to show, before its threads are known.
export type Entry = Omit<Pr, 'threads'> & { updatedAt: string }

// Each PR once: those to work on first (the current branch's, then the
// user's), then those under review.
export const toEntries = (json: ListJson): Entry[] => {
  const d = json.data
  const seen = new Set<number>()
  const take = (nodes: EntryJson[], isReview: boolean) =>
    nodes
      .filter((p): p is EntryJson & { number: number } => typeof p.number === 'number' && !seen.has(p.number) && !!seen.add(p.number))
      .map(p => ({
        number: p.number,
        isReview,
        // A deleted account has no author, and is nobody's.
        isMine: !!p.author && p.author.login === d?.viewer?.login,
        author: p.author?.login ?? 'ghost',
        title: p.title,
        url: p.url,
        branch: p.headRefName,
        updatedAt: p.updatedAt,
      }))
  return [
    ...take([...(d?.repository?.pullRequests.nodes ?? []), ...(d?.mine?.nodes ?? [])], false),
    ...take([...(d?.requested?.nodes ?? []), ...(d?.reviewed?.nodes ?? [])], true),
  ]
}

type CommentJson = { author: { login: string } | null; body: string; url: string; diffHunk: string }
type DetailJson = {
  data?: { repository?: { pullRequest?: { author: { login: string } | null; reviewThreads: { nodes: {
    id: string; isResolved: boolean; isOutdated: boolean; path: string; line: number | null
    comments: { nodes: CommentJson[] }
  }[] } } | null } | null }
}

// A PR's unresolved threads; undefined when GitHub gave no PR.
export const toThreads = (json: DetailJson): Thread[] | undefined => {
  const pr = json.data?.repository?.pullRequest
  if (!pr) return undefined
  return pr.reviewThreads.nodes
    .filter(t => !t.isResolved && t.comments.nodes.length > 0)
    .map(t => {
      // A deleted account has no author.
      const comments = t.comments.nodes.map(c => ({ author: c.author?.login ?? 'ghost', body: c.body.trim() }))
      const first = t.comments.nodes[0]!
      return {
        id: t.id,
        path: t.path,
        line: t.line,
        isOutdated: t.isOutdated,
        url: first.url,
        hunk: first.diffHunk,
        comments,
        isAnswered: comments.length > 1 && comments.at(-1)!.author === pr.author?.login,
      }
    })
}

export const where = (t: Thread) => `${t.path}${t.line ? `:${t.line}` : ''}`

// GitHub's hunk runs from the top of the change down to the commented line,
// so its header counts lines it no longer holds; Code refuses such a diff.
// The last `lines` are kept, the comment's surroundings, under a header
// counted again from them.
// ponytail: fixed 12 lines; scroll the whole hunk if that proves too short.
export const hunkTail = (hunk: string, lines = 12) => {
  const [head = '', ...body] = hunk.split('\n')
  const m = head.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/)
  if (!m) return undefined
  const rows = body.filter(l => /^[ +-]/.test(l))
  const cut = Math.max(0, rows.length - lines)
  const count = (part: string[], sign: string) => part.filter(l => l[0] === ' ' || l[0] === sign).length
  const kept = rows.slice(cut)
  const oldStart = Number(m[1]) + count(rows.slice(0, cut), '-')
  const newStart = Number(m[2]) + count(rows.slice(0, cut), '+')
  return [`@@ -${oldStart},${count(kept, '-')} +${newStart},${count(kept, '+')} @@${m[3]}`, ...kept].join('\n')
}

// The prompt's first line, also how the submit hook knows the prompt is
// still the one `f` prepared.
export const reviewHeader = (pr: Pr, count: number) =>
  `${count > 1 ? `${count} fils` : 'Un fil'} de review de la PR #${pr.number} (${pr.url}) :`

// What `f` puts in the box: each thread where it sits, its code and its
// whole conversation, so Claude also sees the replies already made. When
// the session is on another branch, Claude is told to go to the PR's first.
export const reviewPrompt = (pr: Pr, threads: readonly Thread[], branch: string) =>
  [
    reviewHeader(pr, threads.length),
    ...(branch === pr.branch
      ? []
      : [
          `Ces fils portent sur la branche \`${pr.branch}\`, pas sur la branche courante (\`${branch}\`) : ` +
            `passe dessus avant de corriger (\`gh pr checkout ${pr.number}\`, ou un worktree s'il y a des modifications en cours).`,
        ]),
    ...threads.map(t =>
      [
        `${where(t)}${t.isOutdated ? ' (sur une version antérieure du code)' : ''}`,
        ...t.comments.map(c => `@${c.author} : ${c.body}`),
      ].join('\n'),
    ),
    threads.length > 1 ? 'Traite chacun : corrige le code, ou dis-moi pourquoi tu ne le ferais pas.' : 'Corrige le code, ou dis-moi pourquoi tu ne le ferais pas.',
    // Commits and pushes on the user's own PRs only: another's branch is its
    // author's to push.
    pr.isMine
      ? 'Commite chaque correction en `git commit --fixup=<sha>` du commit qu\'elle corrige, puis pousse la branche.'
      : `C'est la PR de @${pr.author} : corrige en local, sans commiter ni pousser, et dis-moi ce que tu as changé.`,
  ].join('\n\n')

// A thread's file by its name alone, with its folder when another thread of
// the list has a file of the same name.
export const shortWhere = (t: Thread, list: readonly Thread[]) => {
  const parts = t.path.split('/')
  const name = parts.at(-1)!
  const isTwin = list.some(x => x.path !== t.path && x.path.split('/').at(-1) === name)
  return `${isTwin && parts.length > 1 ? `${parts.at(-2)}/` : ''}${name}${t.line ? `:${t.line}` : ''}`
}

// What the thread is about: the first comment's first line, its markdown
// marks dropped, cut to `max` characters.
export const excerpt = (t: Thread, max = 90) => {
  const line = (t.comments[0]?.body ?? '').split('\n').find(l => l.trim()) ?? ''
  // A quote's or heading's leading mark, emphasis and code marks; `<` and
  // `>` inside the text stay (`List<String>`).
  const plain = line.replace(/^\s*[>#]+\s*/, '').replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim()
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain
}

// The PR's title without its trailing tags (`[DEPLOY_PR][poso75]`).
export const cleanTitle = (title: string) => title.replace(/(\s*\[[^\]]*\])+\s*$/, '').trim()
