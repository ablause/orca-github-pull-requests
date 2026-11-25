import { assert, test } from 'orca/testing'
import type { LinkedItem } from '../protocol.ts'
import type { ReferenceBook, Ref } from './mentions.ts'
import { type Asked, questionStore, readQuestion } from './questions.ts'

const item = (ref: Ref): LinkedItem => ({
  kind: 'pr',
  repo: ref.repo,
  number: ref.number,
  title: `PR ${ref.number}`,
  state: 'OPEN',
  isDraft: false,
  stateReason: null
})

const book: ReferenceBook = {
  repoOf: async () => 'acme/app',
  learn: async () => undefined,
  itemAt: () => null,
  // 404 stands for a number GitHub does not know
  resolve: async (refs) => refs.filter((ref) => ref.number !== 404).map(item)
}

const input = (question: string, ...options: string[]) => ({
  questions: [{ question, header: 'Merge', options: options.map((label) => ({ label, description: '' })) }]
})

function mount(stored: unknown = [], writes = true) {
  const shelf = { stored, changes: 0 }
  const store = questionStore({
    shelf: {
      read: async () => shelf.stored,
      write: async (list: Asked[]) => {
        if (!writes) throw new Error('capability_denied')
        shelf.stored = list
      }
    },
    book,
    terminalsIn: async (dir) => (dir === '/work/a' ? ['term_a', 'term_a2'] : ['term_b']),
    changed: () => {
      shelf.changes += 1
    }
  })
  return { store, shelf }
}

const numbers = async (store: ReturnType<typeof mount>['store'], dir = '/work/a') =>
  (await store.waiting(dir)).map((question) => question.items.map((each) => each.number))

test('a question keeps its wording and reads references from its options too', () => {
  const read = readQuestion(input('Which one do I merge?', 'acme/app#12', '#13'))
  assert.equal(read?.text, 'Which one do I merge?')
  assert.match(read?.body ?? '', /acme\/app#12/)
  assert.equal(readQuestion({}), null)
  assert.equal(readQuestion(null), null)
})

test('a waiting question names its pull requests in its own worktree only', async () => {
  const { store, shelf } = mount()
  await store.ask('term_a', input('Can I merge #13 and other/lib#2?'), 1_000)
  const [question] = await store.waiting('/work/a')
  assert.equal(question?.text, 'Can I merge #13 and other/lib#2?')
  assert.deepEqual(
    question?.items.map((each) => `${each.repo}#${each.number}`),
    ['acme/app#13', 'other/lib#2']
  )
  assert.deepEqual(await numbers(store, '/work/b'), [])
  assert.equal(shelf.changes, 1)
})

test('in a question one digit is a reference, and a question naming nothing is left out', async () => {
  const { store } = mount()
  await store.ask('term_a', input('Merge #7 now?'), 1_000)
  await store.ask('term_a2', input('Which colour do you prefer?', 'Red', 'Blue'), 2_000)
  assert.deepEqual(await numbers(store), [[7]])
})

test('a number GitHub does not know is not shown', async () => {
  const { store } = mount()
  await store.ask('term_a', input('Is #404 the one?'), 1_000)
  assert.deepEqual(await numbers(store), [])
})

test('the answer ends the question, and a newer one replaces it', async () => {
  const { store } = mount()
  await store.ask('term_a', input('Merge #13?'), 1_000)
  await store.ask('term_a', input('Merge #14?'), 2_000)
  assert.deepEqual(await numbers(store), [[14]])
  await store.answer('term_a')
  assert.deepEqual(await numbers(store), [])
})

test('a dismissed question ends when its agent works again, not while it waits', async () => {
  const { store } = mount()
  await store.ask('term_a', input('Merge #13?'), 1_000)
  await store.moved('term_a', 'waiting', 1_005)
  // a status that left before the question reached the worker
  await store.moved('term_a', 'working', 900)
  await store.moved('term_b', 'working', 2_000)
  assert.deepEqual(await numbers(store), [[13]])
  await store.moved('term_a', 'working', 2_000)
  assert.deepEqual(await numbers(store), [])
})

test('questions outlive the worker, and a store that refuses writes keeps them for this run', async () => {
  const first = mount()
  await first.store.ask('term_a', input('Merge #13?'), 1_000)
  const restarted = mount(first.shelf.stored)
  assert.deepEqual(await numbers(restarted.store), [[13]])

  const refused = mount('garbage', false)
  await refused.store.ask('term_a', input('Merge #15?'), 1_000)
  assert.deepEqual(await numbers(refused.store), [[15]])
})

test('changes that arrive side by side apply in order', async () => {
  const { store } = mount()
  await Promise.all([
    store.ask('term_a', input('Merge #13?'), 1_000),
    store.ask('term_a2', input('Merge #14?'), 1_001),
    store.answer('term_a')
  ])
  assert.deepEqual(await numbers(store), [[14]])
})
