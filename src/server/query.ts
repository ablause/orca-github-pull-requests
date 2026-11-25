const ACTOR = 'author { login avatarUrl(size: 48) }'
const REACTIONS = 'reactionGroups { content reactors { totalCount } viewerHasReacted }'

const LINKED_FIELDS = 'number title url state repository { nameWithOwner }'

/** The timeline events issues and pull requests share. */
export const SHARED_EVENTS = `... on IssueComment { id ${ACTOR} bodyHTML createdAt url ${REACTIONS} }
        ... on LabeledEvent { id createdAt actor { login } label { name } }
        ... on UnlabeledEvent { id createdAt actor { login } label { name } }
        ... on AssignedEvent { id createdAt actor { login } assignee { ... on User { login } } }
        ... on RenamedTitleEvent { id createdAt actor { login } previousTitle currentTitle }
        ... on ReopenedEvent { id createdAt actor { login } }
        ... on CrossReferencedEvent { id createdAt actor { login } source { ... on Issue { title url number } ... on PullRequest { title url number } } }`

const REPOSITORY_FIELDS = `nameWithOwner
    mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed autoMergeAllowed
    viewerDefaultMergeMethod`

/** What the header and the status card draw, small enough to answer in one quick round trip. */
const HEADER_FIELDS = `id number title url state isDraft createdAt updatedAt headRefOid
      ${ACTOR}
      bodyHTML
      ${REACTIONS}
      baseRefName headRefName headRepository { nameWithOwner }
      additions deletions changedFiles
      commits { totalCount }
      mergeable mergeStateStatus reviewDecision
      viewerCanUpdate viewerCanMergeAsAdmin
      autoMergeRequest { mergeMethod enabledBy { login } }
      mergedAt mergedBy { login }
      labels(first: 20) { nodes { name color } }
      assignees(first: 10) { nodes { login } }
      reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
      closingIssuesReferences(first: 10) { nodes { ${LINKED_FIELDS} stateReason } }
      latestOpinionatedReviews(first: 20) { nodes { state author { login } } }
      lastCommit: commits(last: 1) { nodes { commit { oid statusCheckRollup { state contexts(first: 100) { nodes {
        __typename
        ... on CheckRun { name status conclusion detailsUrl checkSuite { workflowRun { workflow { name } } } }
        ... on StatusContext { context state targetUrl description }
      } } } } } }`

/** The heavy part: review threads and the timeline. */
const CONVERSATION_FIELDS = `reviewThreads(first: 100) { nodes { id isResolved isOutdated path line comments(first: 50) { nodes {
        id ${ACTOR} bodyHTML createdAt diffHunk pullRequestReview { id } ${REACTIONS}
      } } } }
      timelineItems(last: 150) { nodes {
        __typename
        ${SHARED_EVENTS}
        ... on PullRequestReview { id ${ACTOR} bodyHTML state createdAt: submittedAt url ${REACTIONS} }
        ... on PullRequestCommit { id commit { oid abbreviatedOid messageHeadline committedDate url author { user { login avatarUrl(size: 48) } name } } }
        ... on HeadRefForcePushedEvent { id createdAt actor { login } beforeCommit { abbreviatedOid } afterCommit { abbreviatedOid } }
        ... on ReviewRequestedEvent { id createdAt actor { login } requestedReviewer { ... on User { login } ... on Team { name } } }
        ... on ReadyForReviewEvent { id createdAt actor { login } }
        ... on ConvertToDraftEvent { id createdAt actor { login } }
        ... on MergedEvent { id createdAt actor { login } commit { abbreviatedOid } mergeRefName }
        ... on ClosedEvent { id createdAt actor { login } }
        ... on HeadRefDeletedEvent { id createdAt actor { login } }
        ... on AutoMergeEnabledEvent { id createdAt actor { login } }
        ... on AutoMergeDisabledEvent { id createdAt actor { login } }
      } }`

/** One round trip for everything the Conversation tab shows. */
export const PULL_REQUEST_QUERY = `
query ($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    ${REPOSITORY_FIELDS}
    pullRequest(number: $number) {
      ${HEADER_FIELDS}
      ${CONVERSATION_FIELDS}
    }
  }
}`

/**
 * A branch's PR and its header in one round trip, for the first paint of a worktree: open PRs
 * first, as `gh pr view` picks them, then the latest closed or merged one by number only.
 */
export const BRANCH_QUERY = `
query ($owner: String!, $name: String!, $head: String!) {
  repository(owner: $owner, name: $name) {
    ${REPOSITORY_FIELDS}
    open: pullRequests(headRefName: $head, states: [OPEN], first: 5, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { ${HEADER_FIELDS} }
    }
    latest: pullRequests(headRefName: $head, first: 5, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { number headRepository { nameWithOwner } }
    }
  }
}`

/** An issue with its conversation and the pull requests that close it, in one round trip. */
export const ISSUE_QUERY = `
query ($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    issue(number: $number) {
      id number title url state stateReason createdAt
      ${ACTOR}
      bodyHTML
      ${REACTIONS}
      labels(first: 20) { nodes { name color } }
      assignees(first: 10) { nodes { login avatarUrl(size: 48) } }
      closedByPullRequestsReferences(first: 10, includeClosedPrs: true) { nodes { ${LINKED_FIELDS} isDraft } }
      timelineItems(last: 150) { nodes {
        __typename
        ${SHARED_EVENTS}
        ... on ClosedEvent { id createdAt actor { login } stateReason closer { ... on PullRequest { title url number } ... on Commit { abbreviatedOid url } } }
        ... on ConnectedEvent { id createdAt actor { login } subject { ... on PullRequest { title url number } } }
      } }
    }
  }
}`
