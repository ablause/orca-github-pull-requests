import { assert, test } from 'orca/testing'
import { conversationText, extractMentions } from './mentions.ts'

const keys = (text: string, repo: string | null = 'acme/app') =>
  extractMentions(text, repo).map((ref) => `${ref.repo}#${ref.number}`)

test('a conversation names PRs and issues by number, repo and URL', () => {
  assert.deepEqual(keys('Merged PR #1070, see other/lib#12 and https://github.com/acme/web/issues/9 for the rest.'), [
    'acme/app#1070',
    'other/lib#12',
    'acme/web#9'
  ])
})

test('each reference is named once, in reading order', () => {
  assert.deepEqual(keys('#1072 then #1071, back to #1072'), ['acme/app#1072', 'acme/app#1071'])
})

test('a URL or owner/repo reference does not also read as a bare number', () => {
  assert.deepEqual(keys('https://github.com/acme/app/pull/55#issuecomment-1 and acme/app#56'), [
    'acme/app#55',
    'acme/app#56'
  ])
})

test('prose and markup that look like references are left out', () => {
  assert.deepEqual(keys('step #1, colour #C8372D, entity &#39; and anchor page#12, #12-b'), [])
})

test('bare numbers need the worktree repository', () => {
  assert.deepEqual(keys('#1070 and acme/app#3', null), ['acme/app#3'])
})

test('a question counts one digit as a reference, prose does not', () => {
  const question = extractMentions('Merge #7 now?', 'acme/app', true)
  assert.deepEqual(question, [{ repo: 'acme/app', number: 7 }])
  assert.deepEqual(keys('Merge #7 now?'), [])
})

test('a chat names pull requests of any repository, and what its tools printed is left out', () => {
  const text = conversationText([
    { kind: 'message', text: 'I opened https://github.com/acme/app/pull/24 and other/lib#7.' },
    { kind: 'tool', text: 'gh pr view https://github.com/acme/app/pull/999' },
    { kind: 'question', text: 'Merge [app #62](https://github.com/acme/app/pull/62)? #31 can wait.' },
    { kind: 'message' }
  ])
  // a bot's home is no repository: a bare #31 names nothing there
  assert.deepEqual(keys(text, null), ['acme/app#24', 'other/lib#7', 'acme/app#62'])
})
