import type { Pr, Thread } from '../types'

// The user's open PRs in the repo, and the current branch's whoever wrote it:
// one request a poll. `{owner}` and `{repo}` are filled in by `gh api` from
// the repo it runs in, in -F fields only.
export const QUERY = `query($mine: String!, $owner: String!, $repo: String!, $branch: String!) {
  mine: search(query: $mine, type: ISSUE, first: 20) { nodes { ...pr } }
  repository(owner: $owner, name: $repo) { pullRequests(headRefName: $branch, states: OPEN, first: 1) { nodes { ...pr } } } }
fragment pr on PullRequest { number title url headRefName author { login }
  reviewThreads(first: 100) { nodes { id isResolved isOutdated path line
    comments(first: 50) { nodes { author { login } body url diffHunk } } } } }`
export const MINE = 'repo:{owner}/{repo} is:pr is:open author:@me'

export const REPLY = `mutation($id: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) { comment { id } } }`

export const RESOLVE = `mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id } } }`

type CommentJson = { author: { login: string } | null; body: string; url: string; diffHunk: string }
type PrJson = {
  number?: number; title: string; url: string; headRefName: string; author: { login: string } | null
  reviewThreads: { nodes: {
    id: string; isResolved: boolean; isOutdated: boolean; path: string; line: number | null
    comments: { nodes: CommentJson[] }
  }[] }
}
type PrsJson = {
  data?: { mine?: { nodes: PrJson[] }; repository?: { pullRequests: { nodes: PrJson[] } } | null }
}

const toPr = (pr: PrJson & { number: number }): Pr => ({
  number: pr.number,
  title: pr.title,
  url: pr.url,
  branch: pr.headRefName,
  threads: pr.reviewThreads.nodes
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
    }),
})

// The PRs with unresolved threads, the current branch's first, each once.
export const toPrs = (json: PrsJson): Pr[] => {
  const all = [...(json.data?.repository?.pullRequests.nodes ?? []), ...(json.data?.mine?.nodes ?? [])]
  const seen = new Set<number>()
  return all
    .filter((p): p is PrJson & { number: number } => typeof p.number === 'number' && !seen.has(p.number) && !!seen.add(p.number))
    .map(toPr)
    .filter(p => p.threads.length > 0)
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
  ].join('\n\n')
