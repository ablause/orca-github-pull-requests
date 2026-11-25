import { assert, test } from 'orca/testing'
import { agentTerminal, chatSessions, insideWorktree } from './workspace.ts'

test('a PR file opens only inside its worktree', () => {
  assert.equal(insideWorktree('/repo', 'src/app.ts'), 'src/app.ts')
  assert.equal(insideWorktree('/repo', 'src/./lib/app.ts'), 'src/lib/app.ts')
  assert.equal(insideWorktree('/repo', 'src/lib/../app.ts'), null)
  assert.equal(insideWorktree('/repo', '../etc/passwd'), null)
  assert.equal(insideWorktree('/repo', 'src/../../etc'), null)
  assert.equal(insideWorktree('/repo', '/etc/passwd'), null)
  assert.equal(insideWorktree('/repo', 'C:\\Windows\\win.ini'), null)
  assert.equal(insideWorktree('/repo', '\\\\server\\share'), null)
  assert.equal(insideWorktree('/repo', ''), null)
  assert.equal(insideWorktree('/repo', '..\\..\\etc'), null)
  assert.equal(insideWorktree('/repo', '--help'), null)
  assert.equal(insideWorktree('/repo', '..notes.md'), '..notes.md')
})

test('the agent of a worktree is the one asking about the pull request, then its first agent', () => {
  const rows = [
    { handle: 'term_shell', agentIdentity: null },
    { handle: 'term_a', agentIdentity: 'claude' },
    { handle: 'term_b', agentIdentity: 'claude' }
  ]
  assert.deepEqual(agentTerminal(rows, ['term_b']), { terminalId: 'term_b', asking: true })
  assert.deepEqual(agentTerminal(rows, []), { terminalId: 'term_a', asking: false })
  // a question from a terminal that is not an agent of this worktree changes nothing
  assert.deepEqual(agentTerminal(rows, ['term_elsewhere']), { terminalId: 'term_a', asking: false })
})

test('a worktree with only a shell has no agent to open', () => {
  assert.deepEqual(agentTerminal([{ handle: 'term_shell' }], ['term_shell']), { terminalId: null, asking: false })
  assert.deepEqual(agentTerminal([], []), { terminalId: null, asking: false })
})

test('a bot has no terminal and no branch: its chats are found by its workspace', () => {
  const bot = { id: 'folder:bot-a', branch: '', displayName: 'Dependency updates', terminalIds: [] }
  const rows = [
    { kind: 'chat', worktreeId: 'folder:bot-a', orcaSessionId: 'chat-a' },
    { kind: 'chat', worktreeId: 'folder:bot-b', orcaSessionId: 'chat-b' },
    // a terminal agent is read from its screen, and a chat Orca gives no session cannot be read
    { kind: 'terminal', worktreeId: 'folder:bot-a', orcaSessionId: null },
    { kind: 'chat', worktreeId: 'folder:bot-a', orcaSessionId: null }
  ]
  assert.deepEqual(chatSessions(rows, bot), ['chat-a'])
  assert.deepEqual(chatSessions(rows, { ...bot, id: null }), [])
})
