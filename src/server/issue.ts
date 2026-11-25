import type { Issue, IssueAction } from '../protocol.ts'
import { gh, GhError, graphql } from './gh.ts'
import { actorOf, html, linkedOf, reactionsOf, timelineOf } from './pull-request.ts'
import { ISSUE_QUERY } from './query.ts'

// GraphQL payloads are mapped field by field below
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any

export function mapIssue(repository: Raw): Issue {
  const issue = repository.issue
  return {
    id: issue.id,
    repo: repository.nameWithOwner,
    number: issue.number,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    stateReason: issue.stateReason ?? null,
    createdAt: issue.createdAt,
    author: actorOf(issue.author),
    body: html(issue.bodyHTML),
    reactions: reactionsOf(issue.reactionGroups),
    labels: issue.labels.nodes,
    assignees: (issue.assignees.nodes as Raw[]).map(actorOf),
    linkedPulls: ((issue.closedByPullRequestsReferences?.nodes ?? []) as Raw[]).map((raw) => linkedOf(raw, 'pr')),
    timeline: timelineOf(issue.timelineItems.nodes as Raw[], new Map())
  }
}

export async function fetchIssue(repo: string, number: number): Promise<Issue> {
  const [owner, name] = repo.split('/') as [string, string]
  const data = await graphql<{ repository: Raw }>(ISSUE_QUERY, { owner, name, number })
  if (!data.repository?.issue) throw new GhError(`Issue #${number} not found in ${repo}`)
  return mapIssue(data.repository)
}

/** Writes go through `gh -R` with the signed-in account, like the pull request actions. */
export async function runIssueAction(repo: string, number: number, action: IssueAction): Promise<string> {
  const issue = [String(number), '-R', repo]
  switch (action.kind) {
    case 'comment':
      await gh(['issue', 'comment', ...issue, '--body-file', '-'], { input: action.body })
      return 'Comment posted'
    case 'close':
      await gh([
        'issue',
        'close',
        ...issue,
        '--reason',
        action.reason,
        ...(action.body.trim() ? ['--comment', action.body] : [])
      ])
      return action.reason === 'completed' ? 'Issue closed as completed' : 'Issue closed as not planned'
    case 'reopen':
      await gh(['issue', 'reopen', ...issue])
      return 'Issue reopened'
    case 'react':
      await graphql(
        action.add
          ? 'mutation ($id: ID!, $content: ReactionContent!) { addReaction(input: { subjectId: $id, content: $content }) { clientMutationId } }'
          : 'mutation ($id: ID!, $content: ReactionContent!) { removeReaction(input: { subjectId: $id, content: $content }) { clientMutationId } }',
        { id: action.subjectId, content: action.content }
      )
      return ''
  }
}
