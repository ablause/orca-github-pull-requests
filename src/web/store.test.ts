import { assert, test } from 'orca/testing'
import type { WorkspaceRef } from '../protocol'

// store.ts reads the frame's global `orca` when it loads
const sent: { name: string; input: unknown }[] = []
;(globalThis as { orca?: unknown }).orca = {
  plugin: {
    request: (name: string, input: unknown) => {
      sent.push({ name, input })
      return Promise.reject(new Error('offline'))
    }
  }
}
const { askedKeys, check, getState, isRemoving, openLightbox, removeWorkspace, sameWorkspace, setState, setWorkspace } =
  await import('./store')

const main = (...terminalIds: string[]): WorkspaceRef => ({
  id: null,
  branch: 'main',
  displayName: 'main',
  terminalIds
})

test("two repositories' main checkouts are different worktrees", () => {
  assert.equal(sameWorkspace(main('term_a'), main('term_b')), false)
})

test('a terminal opening or closing keeps the same worktree', () => {
  assert.equal(sameWorkspace(main('term_a'), main('term_a', 'term_c')), true)
  assert.equal(sameWorkspace(main('term_a', 'term_c'), main('term_c')), true)
})

test('another branch or name is another worktree', () => {
  assert.equal(sameWorkspace(main('term_a'), { ...main('term_a'), branch: 'feat/x' }), false)
  assert.equal(sameWorkspace(null, null), true)
  assert.equal(sameWorkspace(null, main()), false)
})

test('moving to another worktree closes the open images, a terminal opening does not', () => {
  setWorkspace(main('term_a'))
  openLightbox(['a.png'], 0)
  setWorkspace(main('term_a', 'term_c'))
  assert.notEqual(getState().lightbox, null)
  setWorkspace(main('term_b'))
  assert.equal(getState().lightbox, null)
})

test('a regular probe carries no undefined field: Orca refuses that input', async () => {
  setWorkspace(main('term_d'))
  sent.length = 0
  await check(false)
  const probe = sent.find((call) => call.name === 'pr.probe')
  assert.ok(probe)
  assert.equal(Object.values(probe.input as object).includes(undefined), false)
})

test('a failed removal frees its workspace and names it, wherever the focus went', async () => {
  const going = main('term_e')
  setWorkspace(going)
  const removal = removeWorkspace()
  assert.equal(isRemoving(going), true)
  setWorkspace({ id: null, branch: 'other', displayName: 'other', terminalIds: ['term_f'] })
  assert.equal(isRemoving(getState().workspace), false)
  await removal
  assert.equal(isRemoving(going), false)
  assert.ok(getState().notice?.text.includes(going.displayName))
})

test('a row shows the latest waiting question that names it, and none follows to another worktree', () => {
  const item = {
    kind: 'pr',
    repo: 'Acme/App',
    number: 13,
    title: 'x',
    state: 'OPEN',
    isDraft: false,
    stateReason: null
  }
  setWorkspace(main('term_e'))
  setState({
    questions: [
      {
        terminalId: 'term_e',
        askedAt: 2,
        text: 'Merge #13 now?',
        items: [{ ...item, kind: 'pr', state: 'OPEN' }]
      },
      {
        terminalId: 'term_f',
        askedAt: 1,
        text: 'Close #13?',
        items: [{ ...item, kind: 'pr', state: 'OPEN' }]
      }
    ]
  })
  assert.equal(askedKeys().get('acme/app#13')?.text, 'Merge #13 now?')
  setWorkspace(main('term_g'))
  assert.equal(askedKeys().size, 0)
})
