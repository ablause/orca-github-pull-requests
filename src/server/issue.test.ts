import { assert, test } from 'orca/testing'
import { mapIssue } from './issue.ts'

const raw = (issue: Record<string, unknown>) => ({
  nameWithOwner: 'acme/app',
  issue: {
    id: 'I_1',
    number: 7,
    title: 'Crash on start',
    url: 'https://github.com/acme/app/issues/7',
    state: 'CLOSED',
    stateReason: 'COMPLETED',
    createdAt: '2026-01-01T00:00:00Z',
    author: { login: 'octocat', avatarUrl: null },
    bodyHTML: '<p>It crashes.</p>',
    reactionGroups: [],
    labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
    assignees: { nodes: [] },
    closedByPullRequestsReferences: {
      nodes: [
        {
          number: 8,
          title: 'fix: start',
          url: 'u',
          state: 'MERGED',
          isDraft: false,
          repository: { nameWithOwner: 'acme/app' }
        }
      ]
    },
    timelineItems: { nodes: [] },
    ...issue
  }
})

test('an issue lists the pull requests that close it', () => {
  const issue = mapIssue(raw({}))
  assert.equal(issue.repo, 'acme/app')
  assert.deepEqual(
    issue.linkedPulls.map((pr) => [pr.kind, pr.number, pr.state]),
    [['pr', 8, 'MERGED']]
  )
})

test('closing reads as completed or not planned, linking what closed it', () => {
  const closed = (stateReason: string) =>
    mapIssue(
      raw({
        timelineItems: {
          nodes: [
            {
              __typename: 'ClosedEvent',
              id: 'E_1',
              createdAt: '2026-01-02T00:00:00Z',
              actor: { login: 'octocat' },
              stateReason,
              closer: { title: 'fix: start', number: 8, url: 'https://github.com/acme/app/pull/8' }
            }
          ]
        }
      })
    ).timeline[0]
  const completed = closed('COMPLETED')
  assert.ok(completed?.kind === 'event' && completed.tone === 'completed' && completed.link?.title === 'fix: start #8')
  const notPlanned = closed('NOT_PLANNED')
  assert.ok(notPlanned?.kind === 'event' && notPlanned.tone === 'not-planned')
})
