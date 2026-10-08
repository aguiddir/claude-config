---
name: explain-diff
description: Use when the person must understand or validate a change they did not follow closely (a session's edits, a commit range, a PR, a branch, a module) before merging or deciding, or asks "what changed", "explique ce qui a changé", "montre-moi ce que tu as fait".
---

# Explain a change

## Overview

Reading a diff is the slowest way to understand a change. Hand back the
form that is fastest to understand: a short controlled-language text, a
diagram, or a private web page (after Karpathy, "we'll be spending a lot
more time trying to understand the outputs of language models",
https://x.com/karpathy/status/2105819303471976479).

The page is for the person's own understanding. Being alone, in a hurry,
or not sharing it is not a reason to fall back to terminal prose.

## Scope

| Argument | Scope |
|---|---|
| none | this session's edits; uncommitted changes the session did not make are listed under their own heading, not explained |
| `<sha>..<sha>`, `<sha>` | that range, or that commit (`A..B` excludes A: use `A^..B` to include it) |
| `#123`, PR URL | the PR's diff (`gh pr diff`) |
| a path | that module as it is today (no diff: explain how it works) |

Read the code around the diff and trace each changed flow end to end
before writing. Never explain from the diff alone.

Run no check: no tests, no CI, no analysis. The page explains, the
reader judges. A test result is evidence only when this session
already ran it on the revision explained.

## Form

The medium follows what there is to understand, not the file count.

- No behaviour changes (rename, moved code, a local fix, a config value, a dependency bump), whatever the number of files → **8 lines max in the terminal**, in the writing style below.
- At least one behaviour or flow changes → **a private web page** (Artifact), then 1-3 lines in the terminal: the one sentence, the link, the open points the reader must act on.
- A rule with several cases (thresholds, routing, permissions) → on the page, a table `case → before → after` next to its diagram, one row per case. That is the only interactivity: no script.
- No Artifact tool, or the publish fails → the same 1-3 lines with the path of the HTML file. Never name a page that does not exist.

## The page

Write the page in your scratchpad from `template.html` in this skill's
directory (read it, write the filled copy), then publish it with the
Artifact tool. The template
already handles theme, dark mode, phone width and Mermaid. Do not load
`artifact-design`, do not call `quickstart`, do not preview before
publishing: the reader is waiting.

Diagrams are Mermaid (`flowchart`, `sequenceDiagram`, `stateDiagram-v2`)
inside `<pre class="diagram">` (not `mermaid`: the Artifact service
hijacks that class), 3 to 10 lines each. In a flowchart the
changed nodes get the `changed` class as in the template; labels with
`/`, `(` or `[` go in quotes: `A["/ci 231"]`. A label is 4 words at
most, or breaks with `<br>`: a wide flow shrinks to fit its card, and
long labels are what makes it wide. No hand-drawn SVG.

Sections, in this order, each with its heading. Leave a section out only
when it would be empty, and say so in one line. What is open when the
page loads stays under 500 words and 3 diagrams: a tired reader stops
before that, and writing is the slowest step. The cap never drops an
impact: a fourth flow, a long list of files or extra evidence goes in
a `<details>` block under its section, as in the template.

1. **In one sentence** - what changed and why.
2. **Before / after** - one diagram per flow that changes shape (sequence, state, or data flow), 3 at most. Changed parts stand out. A flow that did not change is not drawn. A flow with two states and one transition, or a changed value, gets one sentence instead. Under each flow, one sentence of observable effect with its evidence: who is affected, in which situation, what result changes ("a 45 s request failed before; it now succeeds, and an outage makes the caller wait longer").
3. **Files by intent** - group the files by what they achieve, not by path. One line per group, then the files; a file that serves several intents is listed by function (`register.tsx: target()`).
4. **Decisions** - each choice made, one line each. The choice and the option not taken each name their own source: a commit message, spec or comment (documented) or the code alone (inferred). Name an option not taken only when a source names it; otherwise write "option not taken: not documented". Never invent one to fill the line.
5. **Boundaries crossed** - API contract, DB schema, config, permissions, security, public behavior. Say "none" when none.
6. **Open points** - risks, doubts, anything to check by hand, and any flow that could not be traced.

Write the page and the terminal answer in French, whatever the language of the code and its comments.

## Writing style

80% of ASD-STE100, on the page and in the terminal:

- One idea per sentence. 20 words max.
- Active voice, present tense. "The poll keeps its result" not "the result is kept by the poll".
- The same word for the same thing throughout. Pick one of "build/job", "thread/conversation", and keep it.
- Every claim about behaviour names its evidence: `file.py: function()`, a test with its result, a commit. A claim with no evidence goes to open points.
- A comparison with code outside the change ("like module X does") cites the `file:line` you read. Not read, no comparison.
- No filler: no "note that", no "it is worth mentioning", no summary of what the diff already shows.

## Common mistakes

| Mistake | Fix |
|---|---|
| Terminal prose because "they just want a quick validation" | Quick to read is the goal. The page is quicker. |
| Sections by commit | Sections by intent. One commit can carry two intents, two commits one. |
| Diagram of the whole system | Only the flows that changed, before and after. |
| "Tests pass" with no names | Command, count, result, from a run this session already made. |
| Explaining the diff line by line | The diff is one click away. Explain what the reader cannot see in it. |
