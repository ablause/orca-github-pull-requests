import { assert, test } from 'orca/testing'
import { isGitHubImageUrl } from './images.ts'

test('the worker only fetches images from GitHub', () => {
  assert.ok(isGitHubImageUrl('https://private-user-images.githubusercontent.com/1/a.png?jwt=x'))
  assert.ok(isGitHubImageUrl('https://camo.githubusercontent.com/abc'))
  assert.ok(isGitHubImageUrl('https://github.com/user-attachments/assets/1'))
  assert.ok(!isGitHubImageUrl('http://github.com/user-attachments/assets/1'))
  assert.ok(!isGitHubImageUrl('https://githubusercontent.com.evil.example/a.png'))
  assert.ok(!isGitHubImageUrl('https://example.com/a.png'))
  assert.ok(!isGitHubImageUrl('not a url'))
})
