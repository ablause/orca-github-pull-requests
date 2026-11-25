import { assert, test } from 'orca/testing'
import { inboxItem } from '../test/fixtures'
import { ago, describeRow, freshness, rowTone } from './format'

const now = Date.parse('2026-11-02T12:00:00Z')

test('a list row leads with what needs action', () => {
  const item = inboxItem({ updatedAt: '2026-11-02T09:00:00Z', comments: 2 })
  assert.equal(describeRow(item, true, now), 'app#42, checks failing, by octocat, 3 hours ago, 2 comments')
  assert.equal(describeRow(item, false, now), '#42, checks failing, by octocat, 3 hours ago, 2 comments')
  assert.equal(rowTone(item), 'danger')
  assert.equal(rowTone(inboxItem({ state: 'MERGED' })), 'done')
})

test('times read like GitHub', () => {
  assert.equal(ago('2026-11-02T11:59:30Z', now), 'just now')
  assert.equal(ago('2026-10-26T12:00:00Z', now), '1 week ago')
})

test('freshness counts seconds within the minute, then falls back to ago', () => {
  const now = 1_000_000_000
  assert.equal(freshness(now - 2_000, now), 'just now')
  assert.equal(freshness(now - 42_000, now), '42s ago')
  assert.equal(freshness(now - 120_000, now), '2 minutes ago')
})
