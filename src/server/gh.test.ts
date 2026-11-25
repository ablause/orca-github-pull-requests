import { assert, test } from 'orca/testing'
import { CommandError } from './exec.ts'
import { ghFailure } from './gh.ts'

test('a missing or signed-out gh says how to set it up', () => {
  assert.match(ghFailure(new CommandError('gh is not installed or not on the PATH', true)), /cli\.github\.com/)
  assert.match(
    ghFailure(new CommandError('To get started with GitHub CLI, please run:  gh auth login')),
    /not signed in\. Run gh auth login/
  )
  // any other failure keeps gh's own words, which name what went wrong
  assert.equal(ghFailure(new CommandError('HTTP 404: Not Found')), 'HTTP 404: Not Found')
})
