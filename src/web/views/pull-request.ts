// One PR in Orca's sidebar: a header that stays put with the merge state and its action, then
// segmented tabs. The layout follows the side panels of agent IDEs (status first, merge beside it)
// rather than github.com's wide page.
import type {
  AgentQuestion,
  Actor,
  Check,
  Commit,
  FixTarget,
  LinkedItem,
  MergeMethod,
  PullRequest,
  Reaction,
  Thread,
  TimelineEntry
} from '../../protocol'
import {
  ago,
  CHECK_LOOK,
  freshness,
  METHOD_LABEL,
  plural,
  REACTION_LABEL,
  REVIEW_VERB,
  stateOf,
  type Tone
} from '../../ui/format'
import { html, useEffect, useLayoutEffect, useMemo, useRef, useState } from '../../vendor/preact.mjs'
import { HtmlBody, imageSources } from '../html-body'
import { Icon, type IconName } from '../icon'
import {
  act,
  askedKeys,
  check,
  editFix,
  findAgent,
  imageData,
  loadedImage,
  loadFiles,
  loadPatch,
  openExternal,
  openFile,
  openFix,
  openAgent,
  openInOrca,
  newMentions,
  openLightbox,
  react,
  isRemoving,
  removeWorkspace,
  sendFix,
  setState,
  showIssue,
  showList,
  showPullRequest,
  useAppState
} from '../store'

const MERGEABLE = new Set(['CLEAN', 'HAS_HOOKS', 'UNSTABLE'])

export function prIcon(pr: Pick<PullRequest, 'state' | 'isDraft'>): { name: IconName; tone: Tone } {
  if (pr.state === 'MERGED') return { name: 'gitMerge', tone: 'done' }
  if (pr.state === 'CLOSED') return { name: 'gitPullRequestClosed', tone: 'danger' }
  if (pr.isDraft) return { name: 'gitPullRequestDraft', tone: 'neutral' }
  return { name: 'gitPullRequest', tone: 'success' }
}

const CHECK_ICON: Record<Check['status'], IconName> = {
  success: 'circleCheck',
  failure: 'circleX',
  pending: 'loaderCircle',
  queued: 'circleDashed',
  skipped: 'circleDashed',
  neutral: 'circleDot',
  cancelled: 'circleX'
}

/** Built as one string: htm drops the space a line break leaves between an expression and text. */
const checksText = (failing: number, running: number, passed: number) =>
  [failing ? `${plural(failing, 'check')} failing` : '', running ? `${running} running` : '', `${passed} passed`]
    .filter(Boolean)
    .join(', ')

const spinIf = (icon: IconName) => (icon === 'loaderCircle' ? ' spin' : '')

/** The one line a reader needs first: what stands between this PR and its merge, worst first. */
function summaryOf(pr: PullRequest): { tone: Tone; icon: IconName; label: string } {
  const failing = pr.checks.filter((c) => c.status === 'failure').length
  const running = pr.checks.filter((c) => c.status === 'pending' || c.status === 'queued').length
  const unresolved = pr.threads.filter((t) => !t.isResolved).length
  if (pr.state === 'MERGED')
    return { tone: 'done', icon: 'gitMerge', label: `Merged${pr.mergedBy ? ` by ${pr.mergedBy}` : ''}` }
  if (pr.state === 'CLOSED') return { tone: 'danger', icon: 'gitPullRequestClosed', label: 'Closed without merging' }
  if (pr.isDraft) return { tone: 'neutral', icon: 'gitPullRequestDraft', label: 'Draft' }
  if (pr.mergeable === 'CONFLICTING') return { tone: 'danger', icon: 'circleAlert', label: 'Merge conflicts' }
  if (failing) return { tone: 'danger', icon: 'circleX', label: `${plural(failing, 'check')} failing` }
  if (pr.reviewDecision === 'CHANGES_REQUESTED')
    return { tone: 'danger', icon: 'circleAlert', label: 'Changes requested' }
  if (pr.mergeStateStatus === 'BEHIND') return { tone: 'warning', icon: 'circleAlert', label: 'Out of date with base' }
  if (running) return { tone: 'warning', icon: 'loaderCircle', label: `${plural(running, 'check')} running` }
  if (pr.reviewDecision === 'REVIEW_REQUIRED') return { tone: 'warning', icon: 'circleDot', label: 'Review required' }
  if (unresolved)
    return { tone: 'warning', icon: 'messageSquare', label: plural(unresolved, 'unresolved conversation') }
  if (MERGEABLE.has(pr.mergeStateStatus)) return { tone: 'success', icon: 'circleCheck', label: 'Ready to merge' }
  if (pr.mergeable === 'UNKNOWN') return { tone: 'neutral', icon: 'loaderCircle', label: 'Checking mergeability' }
  return { tone: 'warning', icon: 'circleAlert', label: 'Blocked by branch rules' }
}

/** The workspace's agents work on its branch, so a PR picked from the list gets no drawer. */
function FixWithAgent({
  fixKey,
  target,
  label = 'Fix with agent'
}: {
  fixKey: string
  target: FixTarget
  label?: string
}) {
  const { view, fix, busy } = useAppState()
  if (view.kind !== 'workspace') return null
  const open = fix?.key === fixKey
  return html`<div class="fix">
    <button class="btn outline sm" onClick=${() => openFix(fixKey, target)}>
      <${Icon} name="bot" size=${14} />${open ? 'Cancel' : label}
    </button>
    ${
      open && fix
        ? fix.loading
          ? html`<span class="xs muted">Drafting the message...</span>`
          : html`<div class="drawer">
              ${fix.error ? html`<p class="notice danger">${fix.error}</p>` : null}
              ${
                fix.agents?.length
                  ? html`<select
                      aria-label="Send to"
                      value=${fix.terminalId ?? ''}
                      onChange=${(e: Event) => editFix({ terminalId: (e.target as HTMLSelectElement).value })}
                    >
                      ${fix.agents.map((agent) => html`<option value=${agent.terminalId}>${agent.label}</option>`)}
                    </select>`
                  : html`<span class="xs muted">Start an agent in this workspace first.</span>`
              }
              <textarea
                rows="8"
                aria-label="Message"
                value=${fix.text}
                onInput=${(e: Event) => editFix({ text: (e.target as HTMLTextAreaElement).value })}
              ></textarea>
              <div class="row">
                <button
                  class="btn primary"
                  disabled=${!fix.terminalId || !fix.text.trim() || busy !== null}
                  onClick=${sendFix}
                >
                  Send to agent
                </button>
              </div>
            </div>`
        : null
    }
  </div>`
}

function StatusLine({ icon, tone, children }: { icon: IconName; tone: Tone; children: unknown }) {
  return html`<div class="status-line">
    <${Icon} name=${icon} size=${14} class=${`tone-${tone}${spinIf(icon)}`} />
    <div class="text">${children}</div>
  </div>`
}

/** The method picked in the details, remembered per PR for this panel run, else the repository's default. */
const chosenMethods = new Map<string, MergeMethod>()
const methodOf = (pr: PullRequest) => chosenMethods.get(`${pr.repo}#${pr.number}`) ?? pr.defaultMergeMethod

/** The merged PR is the workspace's own and the workspace can go: not the main checkout. */
function deletable(pr: PullRequest): boolean {
  const { view, workspace, probe } = useAppState()
  return (
    pr.state === 'MERGED' &&
    view.kind === 'workspace' &&
    workspace?.branch === pr.headRefName &&
    probe?.status === 'found' &&
    probe.mainCheckout === false
  )
}

/** Once merged, the workspace's job is done: offer to delete it where the merge button stood, as Orca's own view does. */
function DeleteWorkspace() {
  const { busy, workspace } = useAppState()
  if (isRemoving(workspace)) {
    return html`<button class="btn outline danger-text" disabled>
      <${Icon} name="loaderCircle" size=${14} class="spin" />Deleting...
    </button>`
  }
  return html`<button class="btn outline danger-text" disabled=${busy !== null} onClick=${() => void removeWorkspace()}>
    <${Icon} name="trash" size=${14} />Delete workspace
  </button>`
}

function MergeButton({ pr }: { pr: PullRequest }) {
  const { busy } = useAppState()
  const [confirming, setConfirming] = useState(false)
  const idle = busy === null
  if (pr.state === 'MERGED') return deletable(pr) ? html`<${DeleteWorkspace} />` : null
  if (pr.state === 'CLOSED') {
    return html`<button class="btn outline" disabled=${!idle} onClick=${() => act('Reopening', { kind: 'reopen' })}>
      Reopen
    </button>`
  }
  if (pr.state !== 'OPEN') return null
  if (pr.isDraft) {
    return html`<button class="btn outline" disabled=${!idle} onClick=${() => act('Marking ready', { kind: 'ready' })}>
      Ready for review
    </button>`
  }
  if (!MERGEABLE.has(pr.mergeStateStatus)) return null
  if (!confirming) {
    return html`<button class="btn merge" disabled=${!idle} onClick=${() => setConfirming(true)}>
      <${Icon} name="gitMerge" size=${14} />Merge
    </button>`
  }
  return html`<div class="row">
    <button class="btn ghost" onClick=${() => setConfirming(false)}>Cancel</button>
    <button
      class="btn merge"
      disabled=${!idle}
      title=${METHOD_LABEL[methodOf(pr)]}
      onClick=${() => {
        setConfirming(false)
        void act('Merging', { kind: 'merge', method: methodOf(pr), headOid: pr.headOid, admin: false })
      }}
    >
      Confirm
    </button>
  </div>`
}

function StatusCard({ pr }: { pr: PullRequest }) {
  const { busy } = useAppState()
  const summary = summaryOf(pr)
  const blocked = summary.tone === 'danger' || summary.tone === 'warning'
  const [open, setOpen] = useState(blocked)
  const [, setMethod] = useState(methodOf(pr))
  const [confirmAdmin, setConfirmAdmin] = useState(false)
  // a blocker that appears opens the details; one that clears folds them again
  useEffect(() => setOpen(blocked), [blocked])
  const idle = busy === null
  const key = `${pr.repo}#${pr.number}`
  const failing = pr.checks.filter((c) => c.status === 'failure').length
  const running = pr.checks.filter((c) => c.status === 'pending' || c.status === 'queued').length
  const passed = pr.checks.filter((c) => c.status === 'success').length
  const unresolved = pr.threads.filter((t) => !t.isResolved).length
  const reviewers = (state: string) =>
    pr.reviewers
      .filter((r) => r.state === state)
      .map((r) => r.name)
      .join(', ')
  const canMerge = MERGEABLE.has(pr.mergeStateStatus)
  const expandable = pr.state === 'OPEN'

  return html`<section class="status" aria-label="Merge status">
    <div class="status-head">
      <button class="summary" aria-expanded=${open} disabled=${!expandable} onClick=${() => setOpen(!open)}>
        <${Icon} name=${summary.icon} size=${16} class=${`tone-${summary.tone}${spinIf(summary.icon)}`} />
        <span class="truncate">${summary.label}</span>
        ${expandable ? html`<${Icon} name="chevronRight" size=${14} class=${`muted chev${open ? ' open' : ''}`} />` : null}
      </button>
      <${MergeButton} pr=${pr} />
    </div>
    ${
      open && expandable
        ? html`<div class="status-body">
            ${
              pr.reviewDecision === 'APPROVED'
                ? html`<${StatusLine} icon="check" tone="success"
                    >Approved${reviewers('APPROVED') ? ` by ${reviewers('APPROVED')}` : ''}<//
                  >`
                : pr.reviewDecision === 'CHANGES_REQUESTED'
                  ? html`<${StatusLine} icon="circleAlert" tone="danger">
                      Changes requested by ${reviewers('CHANGES_REQUESTED') || 'a reviewer'}
                    <//>`
                  : pr.reviewDecision === 'REVIEW_REQUIRED' || reviewers('REQUESTED')
                    ? html`<${StatusLine} icon="circleDot" tone="warning">
                        ${reviewers('REQUESTED') ? `Waiting for ${reviewers('REQUESTED')}` : 'Review required'}
                      <//>`
                    : null
            }
            ${
              pr.checks.length
                ? html`<${StatusLine}
                    icon=${failing ? 'circleX' : running ? 'loaderCircle' : 'circleCheck'}
                    tone=${failing ? 'danger' : running ? 'warning' : 'success'}
                  >
                    <span> ${checksText(failing, running, passed)} </span>
                    ${failing ? html`<${FixWithAgent} fixKey="checks" target=${{ kind: 'checks' }} />` : null}
                  <//>`
                : null
            }
            ${
              unresolved
                ? html`<${StatusLine} icon="messageSquare" tone="warning">
                    <span>${plural(unresolved, 'unresolved conversation')}</span>
                    <${FixWithAgent} fixKey="threads" target=${{ kind: 'threads' }} label="Address with agent" />
                  <//>`
                : null
            }
            ${
              pr.mergeable === 'CONFLICTING'
                ? html`<${StatusLine} icon="circleAlert" tone="danger">
                    <span>Conflicts with <span class="ref">${pr.baseRefName}</span></span>
                    <${FixWithAgent} fixKey="conflicts" target=${{ kind: 'conflicts' }} />
                  <//>`
                : pr.mergeStateStatus === 'BEHIND'
                  ? html`<${StatusLine} icon="circleAlert" tone="warning">
                      <span>Behind <span class="ref">${pr.baseRefName}</span></span>
                      <div class="row">
                        <button
                          class="btn outline sm"
                          disabled=${!idle}
                          onClick=${() => act('Updating branch', { kind: 'updateBranch', rebase: false })}
                        >
                          Update branch
                        </button>
                      </div>
                    <//>`
                  : pr.mergeable === 'MERGEABLE'
                    ? html`<${StatusLine} icon="circleCheck" tone="success">
                        <span>No conflicts with <span class="ref">${pr.baseRefName}</span></span>
                      <//>`
                    : null
            }
            ${
              pr.autoMerge
                ? html`<${StatusLine} icon="gitMerge" tone="done">
                    Auto-merge on: ${METHOD_LABEL[pr.autoMerge.method].toLowerCase()} once requirements are met
                  <//>`
                : null
            }
            <div class="status-foot">
              ${
                pr.mergeMethods.length > 1 && !pr.isDraft
                  ? html`<select
                      aria-label="Merge method"
                      value=${methodOf(pr)}
                      onChange=${(e: Event) => {
                        const value = (e.target as HTMLSelectElement).value as MergeMethod
                        chosenMethods.set(key, value)
                        setMethod(value)
                      }}
                    >
                      ${pr.mergeMethods.map((m) => html`<option value=${m}>${METHOD_LABEL[m]}</option>`)}
                    </select>`
                  : null
              }
              <div class="row wrap">
                ${
                  pr.autoMergeAllowed && !canMerge && !pr.isDraft
                    ? pr.autoMerge
                      ? html`<button
                          class="btn outline sm"
                          disabled=${!idle}
                          onClick=${() => act('Disabling auto-merge', { kind: 'disableAutoMerge' })}
                        >
                          Disable auto-merge
                        </button>`
                      : html`<button
                          class="btn outline sm"
                          disabled=${!idle}
                          onClick=${() => act('Enabling auto-merge', { kind: 'enableAutoMerge', method: methodOf(pr) })}
                        >
                          Enable auto-merge
                        </button>`
                    : null
                }
                ${
                  !canMerge && pr.viewerCanMergeAsAdmin && !pr.isDraft
                    ? confirmAdmin
                      ? html`<button
                          class="btn danger sm"
                          disabled=${!idle}
                          onClick=${() => {
                            setConfirmAdmin(false)
                            void act('Merging', {
                              kind: 'merge',
                              method: methodOf(pr),
                              headOid: pr.headOid,
                              admin: true
                            })
                          }}
                        >
                          Confirm bypass
                        </button>`
                      : html`<button
                          class="btn ghost sm danger-text"
                          disabled=${!idle}
                          onClick=${() => setConfirmAdmin(true)}
                        >
                          Bypass rules and merge
                        </button>`
                    : null
                }
                ${
                  pr.isDraft
                    ? null
                    : html`<button
                        class="btn ghost sm"
                        disabled=${!idle}
                        onClick=${() => act('Converting to draft', { kind: 'draft' })}
                      >
                        Convert to draft
                      </button>`
                }
                <button
                  class="btn ghost sm danger-text"
                  disabled=${!idle}
                  onClick=${() => act('Closing', { kind: 'close' })}
                >
                  Close
                </button>
              </div>
            </div>
          </div>`
        : null
    }
  </section>`
}

function Header({ pr }: { pr: PullRequest }) {
  const { view, busy, checkedAt, refreshing, agent, questions, workspace } = useAppState()
  const icon = prIcon(pr)
  // terminals open and close, and questions come and go: each tells the worker's answer may have changed
  useEffect(() => {
    void findAgent(pr)
  }, [pr.repo, pr.number, pr.headRefName, questions, workspace])
  const working = agent && agent.key === `${pr.repo}#${pr.number}` ? agent : null
  return html`<div class="topbar">
      <button class="btn ghost sm back" onClick=${() => showList('pr')}>
        <${Icon} name="chevronLeft" size=${14} />Pull requests<${NewMentions} />
      </button>
      <span class="grow"></span>
      ${checkedAt ? html`<span class="xxs muted">Updated ${freshness(checkedAt)}</span>` : null}
      ${
        working
          ? html`<button
              class=${`icon-btn${working.asking ? ' asked' : ''}`}
              title=${working.asking ? 'Open the agent asking about this pull request' : 'Open agent'}
              aria-label=${working.asking ? 'Open the agent asking about this pull request' : 'Open agent'}
              onClick=${() => openAgent(working.terminalId)}
            >
              <${Icon} name="bot" />
            </button>`
          : view.kind === 'pr' && pr.state === 'OPEN'
            ? html`<button
                class="icon-btn"
                title="Check out in Orca"
                aria-label="Check out in Orca"
                disabled=${busy !== null}
                onClick=${() => openInOrca(pr.repo, pr.number)}
              >
                <${Icon} name="gitPullRequest" />
              </button>`
            : null
      }
      <button class="icon-btn" title="Refresh" aria-label="Refresh" onClick=${() => check(true)}>
        <${Icon} name="refreshCw" class=${refreshing ? 'spin' : ''} />
      </button>
      <button class="icon-btn" title="Open on GitHub" aria-label="Open on GitHub" onClick=${() => openExternal(pr.url)}>
        <${Icon} name="externalLink" />
      </button>
    </div>
    <header class="header">
      <div class="pr-id">
        <${Icon} name=${icon.name} class=${`tone-${icon.tone}`} />
        <span class="number">#${pr.number}</span>
        <span class=${`badge ${icon.tone}`}>${stateOf(pr).label}</span>
        <${AskedHere} repo=${pr.repo} number=${pr.number} />
      </div>
      <h1>${pr.title}</h1>
      <div class="branches">
        <span class="ref">${pr.headRefName}</span>
        <span>into</span>
        <span class="ref">${pr.baseRefName}</span>
        <span class="add">+${pr.additions}</span>
        <span class="del">-${pr.deletions}</span>
      </div>
      <${LinkedItems} verb="Closes" items=${pr.closingIssues} />
      <${StatusCard} key=${`${pr.repo}#${pr.number}`} pr=${pr} />
    </header>`
}

/** On the back button: what the agents named since the list last showed it. */
export function NewMentions() {
  useAppState()
  const count = newMentions()
  return count > 0
    ? html`<span class="pill accent" title=${`${count} new from agents`} aria-label=${`${count} new from agents`}
        >${count}</span
      >`
    : null
}

/** Marks what a question names, on its row or on its own page: an agent is held up on it, which a mention is not. */
export function QuestionTag({ question }: { question: AgentQuestion }) {
  return html`<span class="tag asked" title=${`An agent of this worktree asked: ${question.text}`}
    ><${Icon} name="messageCircleQuestion" size=${12} />Question</span
  >`
}

/** The tag of the pull request or issue the screen is about, when a question names it. */
export function AskedHere({ repo, number }: { repo: string; number: number }) {
  useAppState()
  const question = askedKeys().get(`${repo}#${number}`.toLowerCase())
  return question ? html`<${QuestionTag} question=${question} />` : null
}

/** The other side of a PR and issue pair: the issues a PR closes, the PRs that close an issue. */
export function LinkedItems({ verb, items }: { verb: string; items: LinkedItem[] }) {
  if (items.length === 0) return null
  return html`<div class="linked">
    <span class="muted">${verb}</span>
    ${items.map(
      (item) =>
        html`<button
          class="linked-item"
          key=${`${item.repo}#${item.number}`}
          title=${item.title}
          onClick=${() => (item.kind === 'issue' ? showIssue(item.repo, item.number) : showPullRequest(item.repo, item.number))}
        >
          <${Icon} name=${linkedIcon(item).name} size=${12} class=${`tone-${linkedIcon(item).tone}`} />
          <span class="truncate">#${item.number} ${item.title}</span>
        </button>`
    )}
  </div>`
}

export function issueIcon(issue: { state: string; stateReason: string | null }): { name: IconName; tone: Tone } {
  if (issue.state === 'OPEN') return { name: 'circleDot', tone: 'success' }
  if (issue.stateReason === 'NOT_PLANNED') return { name: 'circleSlash', tone: 'neutral' }
  return { name: 'circleCheck', tone: 'done' }
}

const linkedIcon = (item: LinkedItem) => (item.kind === 'issue' ? issueIcon(item) : prIcon(item))

export function Reactions({ subjectId, reactions }: { subjectId: string; reactions: Reaction[] }) {
  const { busy } = useAppState()
  if (reactions.length === 0) return null
  return html`<div class="reactions">
    ${reactions.map(
      (reaction) =>
        html`<button
          class=${`chip${reaction.mine ? ' mine' : ''}`}
          disabled=${busy !== null}
          onClick=${() => react(subjectId, reaction.content, !reaction.mine)}
        >
          ${REACTION_LABEL[reaction.content] ?? reaction.content} ${reaction.count}
        </button>`
    )}
  </div>`
}

function Diff({ patch, tail }: { patch: string; tail?: number }) {
  const lines = patch.split('\n')
  return html`<pre class="diff">
${(tail ? lines.slice(-tail) : lines).map((line) => {
      const kind = line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : ''
      return html`<span class=${`line ${kind}`}>${line || ' '}</span>`
    })}</pre>`
}

function ThreadView({ thread }: { thread: Thread }) {
  const { busy, view } = useAppState()
  const [reply, setReply] = useState('')
  const [open, setOpen] = useState(!thread.isResolved)
  const state = thread.isResolved
    ? 'resolved'
    : thread.isOutdated
      ? 'outdated'
      : plural(thread.comments.length, 'comment')
  return html`<div class="thread">
    <button class="thread-head" aria-expanded=${open} onClick=${() => setOpen(!open)}>
      <${Icon} name="chevronRight" size=${14} class=${`chev${open ? ' open' : ''}`} />
      <span class="mono xs truncate grow">${thread.path}${thread.line ? `:${thread.line}` : ''}</span>
      <span class=${`xxs ${thread.isResolved ? 'tone-success' : 'muted'}`}>${state}</span>
    </button>
    ${
      open
        ? html`<div class="thread-body">
            ${thread.diffHunk ? html`<${Diff} patch=${thread.diffHunk} tail=${6} />` : null}
            ${thread.comments.map(
              (item) =>
                html`<div class="thread-comment">
                  <div class="meta">
                    <${Avatar} actor=${item.author} size=${16} /><strong>${item.author.login}</strong
                    ><span>${ago(item.createdAt)}</span>
                  </div>
                  <${HtmlBody} source=${item.body} />
                  <${Reactions} subjectId=${item.id} reactions=${item.reactions} />
                </div>`
            )}
            <textarea
              rows="2"
              placeholder="Reply"
              aria-label="Reply"
              value=${reply}
              onInput=${(e: Event) => setReply((e.target as HTMLTextAreaElement).value)}
            ></textarea>
            <div class="row wrap">
              <button
                class="btn outline sm"
                disabled=${!reply.trim() || busy !== null}
                onClick=${async () => {
                  if (await act('Replying', { kind: 'reply', threadId: thread.id, body: reply })) setReply('')
                }}
              >
                Reply
              </button>
              <button
                class="btn ghost sm"
                disabled=${busy !== null}
                onClick=${() => act('', { kind: 'resolve', threadId: thread.id, resolved: !thread.isResolved })}
              >
                ${thread.isResolved ? 'Unresolve' : 'Resolve'}
              </button>
              ${
                view.kind === 'workspace'
                  ? html`<button class="btn ghost sm" onClick=${() => openFile(thread.path, thread.line)}>
                      Open file
                    </button>`
                  : null
              }
            </div>
            ${
              thread.isResolved
                ? null
                : html`<${FixWithAgent}
                    fixKey=${`thread:${thread.id}`}
                    target=${{ kind: 'thread', threadId: thread.id }}
                  />`
            }
          </div>`
        : null
    }
  </div>`
}

function Avatar({ actor, size = 20 }: { actor: Actor; size?: number }) {
  const [data, setData] = useState<string | null>(() => (actor.avatarUrl ? loadedImage(actor.avatarUrl) : null))
  useEffect(() => {
    if (!actor.avatarUrl) return
    let live = true
    imageData(actor.avatarUrl).then(
      (value) => live && setData(value),
      () => undefined
    )
    return () => {
      live = false
    }
  }, [actor.avatarUrl])
  return html`<span class="avatar" style=${`width:${size}px;height:${size}px`} aria-hidden="true">
    ${data ? html`<img src=${data} alt="" />` : actor.login.slice(0, 1).toUpperCase()}
  </span>`
}

/** The head of a comment card: avatar, name, then when, as Orca draws its comments. */
function CardHead({ actor, detail, children }: { actor: Actor; detail: string; children?: unknown }) {
  return html`<div class="card-head">
    <${Avatar} actor=${actor} />
    <div class="who grow"><strong class="truncate">${actor.login}</strong><span class="truncate">${detail}</span></div>
    ${children}
  </div>`
}

/** What a PR and an issue share: an opening post and a timeline. */
type Subject = Pick<PullRequest, 'id' | 'author' | 'createdAt' | 'body' | 'reactions' | 'timeline'>

/** A long description folds behind "Show more" so the timeline stays in reach. */
export function Description({ pr }: { pr: Subject }) {
  // the content is measured inside the clamp, whose own height the fold changes
  const content = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [tall, setTall] = useState(false)
  useLayoutEffect(() => {
    const element = content.current
    if (!element) return
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setTall(element.offsetHeight > 340))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [pr.body])
  return html`<div class="card">
    <${CardHead} actor=${pr.author} detail=${`opened ${ago(pr.createdAt)}`} />
    <div class="card-body">
      <div class=${tall && !expanded ? 'clamp' : ''}>
        <div ref=${content}><${HtmlBody} source=${pr.body} empty="No description provided." /></div>
      </div>
      ${
        tall
          ? html`<div>
              <button class="btn ghost sm" onClick=${() => setExpanded(!expanded)}>
                ${expanded ? 'Show less' : 'Show more'}
              </button>
            </div>`
          : null
      }
      <${Reactions} subjectId=${pr.id} reactions=${pr.reactions} />
    </div>
  </div>`
}

const EVENT_LOOK: Record<string, { icon: IconName; tone: Tone }> = {
  completed: { icon: 'circleCheck', tone: 'done' },
  'not-planned': { icon: 'circleSlash', tone: 'neutral' },
  merged: { icon: 'gitMerge', tone: 'done' },
  closed: { icon: 'gitPullRequestClosed', tone: 'danger' },
  open: { icon: 'gitPullRequest', tone: 'success' },
  draft: { icon: 'gitPullRequestDraft', tone: 'neutral' },
  muted: { icon: 'dot', tone: 'neutral' }
}

/** On an issue, opening and closing read as issue states rather than pull request ones. */
const ISSUE_EVENT_LOOK: Record<string, { icon: IconName; tone: Tone }> = {
  open: { icon: 'circleDot', tone: 'success' },
  closed: { icon: 'circleCheck', tone: 'done' }
}

export function Entry({ entry, issue = false }: { entry: TimelineEntry; issue?: boolean }) {
  switch (entry.kind) {
    case 'comment':
      return html`<div class="card">
        <${CardHead} actor=${entry.author} detail=${ago(entry.createdAt)} />
        <div class="card-body">
          <${HtmlBody} source=${entry.body} />
          <${Reactions} subjectId=${entry.id} reactions=${entry.reactions} />
        </div>
      </div>`
    case 'review': {
      const tone: Tone =
        entry.state === 'APPROVED' ? 'success' : entry.state === 'CHANGES_REQUESTED' ? 'danger' : 'neutral'
      const icon: IconName =
        entry.state === 'APPROVED'
          ? 'circleCheck'
          : entry.state === 'CHANGES_REQUESTED'
            ? 'circleAlert'
            : 'messageSquareText'
      const hasBody = Boolean(entry.body) || entry.reactions.length > 0 || entry.threads.length > 0
      return html`<div class="card">
        <${CardHead}
          actor=${entry.author}
          detail=${`${REVIEW_VERB[entry.state] ?? 'reviewed'}, ${ago(entry.createdAt)}`}
        >
          <${Icon} name=${icon} size=${14} class=${`tone-${tone}`} />
        <//>
        ${
          hasBody
            ? html`<div class="card-body">
                ${entry.body ? html`<${HtmlBody} source=${entry.body} />` : null}
                <${Reactions} subjectId=${entry.id} reactions=${entry.reactions} />
                ${entry.threads.map((thread) => html`<${ThreadView} key=${thread.id} thread=${thread} />`)}
              </div>`
            : null
        }
      </div>`
    }
    case 'commits':
      return html`<${CommitGroup} commits=${entry.commits} />`
    case 'event': {
      const look = (issue ? ISSUE_EVENT_LOOK[entry.tone] : undefined) ?? EVENT_LOOK[entry.tone] ?? EVENT_LOOK.muted!
      return html`<div class="event">
        <${Icon} name=${look.icon} size=${14} class=${`tone-${look.tone}`} />
        <span class="grow">
          <strong>${entry.actor ?? 'Someone'}</strong>${` ${entry.text}`}
          ${entry.label ? html`${' '}<span class="ref">${entry.label}</span>` : null}
          ${
            entry.link
              ? html`${' '}<a href="#" onClick=${(e: Event) => (e.preventDefault(), openExternal(entry.link!.url))}
                    >${entry.link.title}</a
                  >`
              : null
          }
          ${`, ${ago(entry.createdAt)}`}
        </span>
      </div>`
    }
  }
}

function Composer() {
  const { busy } = useAppState()
  const [text, setText] = useState('')
  const idle = busy === null
  const send = (label: string, action: Parameters<typeof act>[1]) => async () => {
    if (await act(label, action)) setText('')
  }
  return html`<div class="composer">
    <textarea
      rows="3"
      placeholder="Leave a comment"
      aria-label="Comment"
      value=${text}
      onInput=${(e: Event) => setText((e.target as HTMLTextAreaElement).value)}
    ></textarea>
    <div class="row wrap">
      <button
        class="btn primary"
        disabled=${!text.trim() || !idle}
        onClick=${send('Commenting', { kind: 'comment', body: text })}
      >
        Comment
      </button>
      <button
        class="btn outline"
        disabled=${!idle}
        onClick=${send('Approving', { kind: 'review', event: 'approve', body: text })}
      >
        Approve
      </button>
      <button
        class="btn ghost danger-text"
        disabled=${!text.trim() || !idle}
        onClick=${send('Requesting changes', { kind: 'review', event: 'request-changes', body: text })}
      >
        Request changes
      </button>
    </div>
  </div>`
}

/** A push of many commits reads as a few lines; the rest stay one press away. */
function CommitGroup({ commits }: { commits: Commit[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? commits : commits.slice(0, 3)
  return html`<div class="event">
    <${Icon} name="gitCommitHorizontal" size=${14} />
    <div class="grow">
      <div>${plural(commits.length, 'commit')} pushed</div>
      ${shown.map(
        (commit) =>
          html`<button class="commit-line" onClick=${() => openExternal(commit.url)}>
            <span class="truncate grow">${commit.message}</span><code class="xxs muted">${commit.short}</code>
          </button>`
      )}
      ${
        commits.length > 3
          ? html`<button class="btn ghost sm" style="margin-left:-8px" onClick=${() => setAll(!all)}>
              ${all ? 'Show less' : `Show ${commits.length - 3} more`}
            </button>`
          : null
      }
    </div>
  </div>`
}

function bodiesOf(pr: Subject): string[] {
  return [
    pr.body,
    ...pr.timeline.flatMap((entry) =>
      entry.kind === 'comment'
        ? [entry.body]
        : entry.kind === 'review'
          ? [entry.body, ...entry.threads.flatMap((t) => t.comments.map((c) => c.body))]
          : []
    )
  ]
}

function Thumbnail({ url, index, urls }: { url: string; index: number; urls: string[] }) {
  const [data, setData] = useState<string | null>(() => loadedImage(url))
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    imageData(url).then(
      (value) => live && setData(value),
      () => live && setFailed(true)
    )
    return () => {
      live = false
    }
  }, [url])
  return html`<button
    class="thumb"
    aria-label=${`Image ${index + 1} of ${urls.length}`}
    onClick=${() => (failed ? openExternal(url) : openLightbox(urls, index))}
  >
    ${data ? html`<img src=${data} alt="" />` : html`<span class="xxs muted">${failed ? 'Open on GitHub' : ''}</span>`}
  </button>`
}

/** The PR's images first: the reason to open this panel is often a screenshot. */
export function ImageStrip({ pr }: { pr: Subject }) {
  const urls = useMemo(() => imageSources(bodiesOf(pr)), [pr])
  if (urls.length === 0) return null
  return html`<section class="images" aria-label="Images">
    <div class="section-head">
      <${Icon} name="image" size=${14} class="muted" />
      <h2 class="section-label">Images</h2>
      <span class="pill">${urls.length}</span>
    </div>
    <div class="strip">
      ${urls.map((url, index) => html`<${Thumbnail} key=${url.split('?')[0]} url=${url} index=${index} urls=${urls} />`)}
    </div>
  </section>`
}

function Conversation({ pr }: { pr: PullRequest }) {
  if (pr.partial) {
    return html`<div class="timeline">
      <${ImageStrip} pr=${pr} />
      <${Description} pr=${pr} />
      <p class="empty">Loading the conversation...</p>
    </div>`
  }
  return html`<div class="timeline">
    <${ImageStrip} pr=${pr} />
    <${Description} pr=${pr} />
    ${pr.timeline.map((entry) => html`<${Entry} key=${entry.id} entry=${entry} />`)}
    <${Composer} />
  </div>`
}

const CHECK_ORDER = ['failure', 'pending', 'queued', 'cancelled', 'neutral', 'skipped', 'success']

function Checks({ pr }: { pr: PullRequest }) {
  if (pr.checks.length === 0) return html`<p class="empty">No checks on the last commit.</p>`
  const sorted = [...pr.checks].sort((a, b) => CHECK_ORDER.indexOf(a.status) - CHECK_ORDER.indexOf(b.status))
  return html`<div class="stack">
    ${
      pr.checks.some((c) => c.status === 'failure')
        ? html`<${FixWithAgent} fixKey="checks" target=${{ kind: 'checks' }} label="Fix failing checks with agent" />`
        : null
    }
    <div class="list">
      ${sorted.map(
        (item) =>
          html`<button
            class="list-row"
            disabled=${!item.url}
            title=${item.url ? 'Open the logs on GitHub' : ''}
            onClick=${() => item.url && openExternal(item.url)}
          >
            <${Icon}
              name=${CHECK_ICON[item.status]}
              size=${14}
              class=${`tone-${CHECK_LOOK[item.status].tone}${spinIf(CHECK_ICON[item.status])}`}
            />
            <span class="body">
              <span class="primary">${item.name}</span>
              ${item.workflow ? html`<span class="secondary">${item.workflow}</span>` : null}
            </span>
            <span class="side">
              ${CHECK_LOOK[item.status].label} ${item.url ? html`<${Icon} name="externalLink" size=${12} />` : null}
            </span>
          </button>`
      )}
    </div>
  </div>`
}

const FILE_STATUS: Record<string, { letter: string; tone: Tone }> = {
  added: { letter: 'A', tone: 'success' },
  removed: { letter: 'D', tone: 'danger' },
  renamed: { letter: 'R', tone: 'warning' },
  modified: { letter: 'M', tone: 'warning' }
}

function Files() {
  const { files, patches, view } = useAppState()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  if (!files) return html`<p class="empty">Loading the changed files...</p>`
  if ('error' in files) return html`<p class="notice danger">${files.error}</p>`
  if (files.list.length === 0) return html`<p class="empty">No changed files.</p>`
  return html`<div class="stack" style="gap:4px">
    ${files.truncated ? html`<p class="notice warning">Only the first 300 files are shown.</p>` : null}
    <div class="list">
      ${files.list.map((file) => {
        const status = FILE_STATUS[file.status] ?? { letter: 'M', tone: 'warning' as Tone }
        const slash = file.filename.lastIndexOf('/')
        const patch = patches[file.filename]
        return html`<div key=${file.filename}>
          <div class="row" style="gap:0">
            <button
              class="list-row grow"
              aria-expanded=${!!open[file.filename]}
              onClick=${() => {
                setOpen({ ...open, [file.filename]: !open[file.filename] })
                void loadPatch(file.filename)
              }}
            >
              <span class=${`file-status tone-${status.tone}`}>${status.letter}</span>
              <span class="body">
                <span class="primary">${file.filename.slice(slash + 1)}</span>
                ${slash > 0 ? html`<span class="secondary">${file.filename.slice(0, slash)}</span>` : null}
              </span>
              ${
                file.additions || file.deletions
                  ? html`<span class="side"
                      ><span class="add">+${file.additions}</span><span class="del">-${file.deletions}</span></span
                    >`
                  : null
              }
            </button>
            ${
              view.kind === 'workspace' && file.status !== 'removed'
                ? html`<button
                    class="icon-btn"
                    title="Open in the editor"
                    aria-label=${`Open ${file.filename} in the editor`}
                    onClick=${() => openFile(file.filename)}
                  >
                    <${Icon} name="externalLink" size=${14} />
                  </button>`
                : null
            }
          </div>
          ${
            open[file.filename]
              ? patch === undefined || patch === 'loading'
                ? html`<p class="xs muted" style="margin:0;padding:4px 6px">Loading the diff...</p>`
                : patch === null
                  ? html`<p class="xs muted" style="margin:0;padding:4px 6px">
                      No diff on GitHub: the file is binary or too large.
                    </p>`
                  : html`<div style="padding:4px 0 8px"><${Diff} patch=${patch} /></div>`
              : null
          }
        </div>`
      })}
    </div>
  </div>`
}

function Commits({ pr }: { pr: PullRequest }) {
  const commits: Commit[] = pr.timeline.flatMap((entry) => (entry.kind === 'commits' ? entry.commits : []))
  if (pr.partial) return html`<p class="empty">Loading the commits...</p>`
  if (commits.length === 0) return html`<p class="empty">No commits in the loaded history.</p>`
  return html`<div class="list">
    ${commits.map(
      (commit) =>
        html`<button class="list-row" onClick=${() => openExternal(commit.url)}>
          <${Icon} name="gitCommitHorizontal" size=${14} class="muted" />
          <span class="body">
            <span class="primary">${commit.message}</span>
            <span class="secondary">${commit.author.login}, ${ago(commit.date)}</span>
          </span>
          <code class="side">${commit.short}</code>
        </button>`
    )}
  </div>`
}

function Tabs({ pr }: { pr: PullRequest }) {
  const { tab } = useAppState()
  const failing = pr.checks.some((c) => c.status === 'failure')
  const tabs: [string, string, number | null][] = [
    ['conversation', 'Conversation', null],
    ['checks', 'Checks', pr.checks.length],
    ['files', 'Files', pr.changedFiles],
    ['commits', 'Commits', pr.commitCount]
  ]
  const select = (value: string) => {
    setState({ tab: value })
    if (value === 'files') void loadFiles()
  }
  return html`<div class="tabs" role="group" aria-label="Pull request">
    ${tabs.map(
      ([value, label, count]) =>
        html`<button
          aria-pressed=${tab === value}
          class=${tab === value ? 'tab active' : 'tab'}
          onClick=${() => select(value)}
        >
          ${label}${count ? html`<span class=${`count${value === 'checks' && failing ? ' tone-danger' : ''}`}>${count}</span>` : null}
        </button>`
    )}
  </div>`
}

export function PullRequestView({ pr }: { pr: PullRequest }) {
  const { tab, busy, notice, probeError } = useAppState()
  return html`<div>
    <${Header} pr=${pr} />
    <div class="stack" style="padding-top:12px">
      ${busy ? html`<p class="xs muted" style="margin:0">${busy}...</p>` : null}
      ${notice ? html`<p class=${`notice ${notice.tone}`}>${notice.text}</p>` : null}
      ${probeError ? html`<p class="notice warning">${probeError}</p>` : null}
      <${Tabs} pr=${pr} />
      ${
        tab === 'checks'
          ? html`<${Checks} pr=${pr} />`
          : tab === 'files'
            ? html`<${Files} />`
            : tab === 'commits'
              ? html`<${Commits} pr=${pr} />`
              : html`<${Conversation} pr=${pr} />`
      }
    </div>
  </div>`
}
