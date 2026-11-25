import type { Action, MergeMethod } from '../protocol.ts'
import { gh, graphql } from './gh.ts'

const METHOD_FLAG: Record<MergeMethod, string> = { MERGE: '--merge', SQUASH: '--squash', REBASE: '--rebase' }

/**
 * Every write goes through `gh -R`, never through the workspace checkout: merging must not switch
 * or delete the branch an agent is working on.
 */
export async function runAction(repo: string, number: number, action: Action): Promise<string> {
  const pr = [String(number), '-R', repo]
  switch (action.kind) {
    case 'merge': {
      const args = ['pr', 'merge', ...pr, METHOD_FLAG[action.method]]
      // refuses to merge if someone pushed after the panel last loaded
      if (action.headOid) args.push('--match-head-commit', action.headOid)
      if (action.admin) args.push('--admin')
      await gh(args, { timeoutMs: 60_000 })
      return `Pull request #${number} merged`
    }
    case 'enableAutoMerge':
      await gh(['pr', 'merge', ...pr, '--auto', METHOD_FLAG[action.method]])
      return 'Auto-merge enabled'
    case 'disableAutoMerge':
      await gh(['pr', 'merge', ...pr, '--disable-auto'])
      return 'Auto-merge disabled'
    case 'ready':
      await gh(['pr', 'ready', ...pr])
      return 'Ready for review'
    case 'draft':
      await gh(['pr', 'ready', ...pr, '--undo'])
      return 'Converted to draft'
    case 'close':
      await gh(['pr', 'close', ...pr])
      return 'Pull request closed'
    case 'reopen':
      await gh(['pr', 'reopen', ...pr])
      return 'Pull request reopened'
    case 'updateBranch':
      await gh(['pr', 'update-branch', ...pr, ...(action.rebase ? ['--rebase'] : [])], { timeoutMs: 60_000 })
      return 'Branch updated'
    case 'comment':
      await gh(['pr', 'comment', ...pr, '--body-file', '-'], { input: action.body })
      return 'Comment posted'
    case 'review': {
      const flag =
        action.event === 'approve'
          ? '--approve'
          : action.event === 'request-changes'
            ? '--request-changes'
            : '--comment'
      await gh(['pr', 'review', ...pr, flag, '--body-file', '-'], { input: action.body })
      return action.event === 'approve'
        ? 'Approved'
        : action.event === 'request-changes'
          ? 'Changes requested'
          : 'Review submitted'
    }
    case 'reply':
      await graphql(
        'mutation ($id: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) { clientMutationId } }',
        { id: action.threadId, body: action.body }
      )
      return 'Reply posted'
    case 'resolve':
      await graphql(
        action.resolved
          ? 'mutation ($id: ID!) { resolveReviewThread(input: { threadId: $id }) { clientMutationId } }'
          : 'mutation ($id: ID!) { unresolveReviewThread(input: { threadId: $id }) { clientMutationId } }',
        { id: action.threadId }
      )
      return action.resolved ? 'Conversation resolved' : 'Conversation unresolved'
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
