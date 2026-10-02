import type { Pr, Thread } from '../types'

// `{owner}` and `{repo}` are filled in by `gh api` from the repo it runs in.
export const QUERY = `query($owner: String!, $repo: String!, $n: Int!) {
  repository(owner: $owner, name: $repo) { pullRequest(number: $n) { url author { login }
    reviewThreads(first: 100) { nodes { id isResolved isOutdated path line
      comments(first: 50) { nodes { author { login } body url diffHunk } } } } } } }`

export const REPLY = `mutation($id: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) { comment { id } } }`

export const RESOLVE = `mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id } } }`

type CommentJson = { author: { login: string } | null; body: string; url: string; diffHunk: string }
type ThreadsJson = {
  data?: { repository?: { pullRequest?: { url: string; author: { login: string } | null; reviewThreads: { nodes: {
    id: string; isResolved: boolean; isOutdated: boolean; path: string; line: number | null
    comments: { nodes: CommentJson[] }
  }[] } } | null } | null }
}

export const toPr = (number: number, json: ThreadsJson): Pr | null => {
  const pr = json.data?.repository?.pullRequest
  if (!pr) return null
  const threads: Thread[] = pr.reviewThreads.nodes
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
  return { number, url: pr.url, threads }
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
// whole conversation, so Claude also sees the replies already made.
export const reviewPrompt = (pr: Pr, threads: readonly Thread[]) =>
  [
    reviewHeader(pr, threads.length),
    ...threads.map(t =>
      [
        `${where(t)}${t.isOutdated ? ' (sur une version antérieure du code)' : ''}`,
        ...t.comments.map(c => `@${c.author} : ${c.body}`),
      ].join('\n'),
    ),
    threads.length > 1 ? 'Traite chacun : corrige le code, ou dis-moi pourquoi tu ne le ferais pas.' : 'Corrige le code, ou dis-moi pourquoi tu ne le ferais pas.',
  ].join('\n\n')
