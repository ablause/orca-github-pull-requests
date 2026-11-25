# GitHub for Orca

The pull request of the focused worktree's branch in an Orca sidebar panel, images included, with the repository's pull requests and issues one step back.

## The panel

One **GitHub** panel in Orca's own look (its theme tokens, type scale and Lucide icons) that follows the focused worktree.

It opens on the pull request of that worktree's branch. A status card leads: one line for what stands between the PR and its merge, worst first (conflicts, failing checks, changes requested, out of date, checks running, review required, unresolved conversations, or ready to merge), with the **Merge** button beside it and a confirmation step. Unfolded, it lists each blocker with its action (Fix with agent, Update branch) and holds the merge method, auto-merge, the admin bypass, draft and close. Only the top bar (back, refresh, open on GitHub, last update) stays pinned while scrolling.

The **Conversation** tab starts with the PR's images as thumbnails: press one to see it full size and move through the others. The image opens fitted to the panel: a click shows it at real size around the point clicked, the mouse wheel or a trackpad pinch zooms around the pointer, a drag, a trackpad scroll or the arrow keys pan it, and `+`, `-` and `0` zoom in, out and back to fit. Then the description (folded past a screen, with Show more), comments and reviews with their threads (resolved ones folded, each with Reply, Resolve, Open file and Fix with agent), pushes folded to three commits, events, and the comment form. **Checks** lists failing checks first, each opening its logs. **Files** lists changed files with their diffs, and opens a file in Orca's editor. **Commits** lists the commits.

The back button leads to the repository's list: **Pull requests** or **Issues** on top, then Open and Closed, with the worktree's own PR highlighted, or pinned on top when the list leaves it out. Any PR in the list opens in the same panel, with a button to check it out in Orca. When a worktree in Orca is already on the PR's branch and an agent runs there, that button becomes **Open agent**, on the worktree's own PR too: it shows the agent's terminal, the one asking a question about this PR first. A branch without a pull request shows the list directly; with no worktree focused, the panel shows the pull requests and issues that involve you.

Rows the focused worktree's agents named (`#1072`, `owner/repo#12` or a GitHub URL) carry a **Mentioned** tag where they already stand in the list, and the Pull requests and Issues tabs count them, so a mentioned issue is not missed from the PR tab. Mentions are read from what the worktree's terminals render when an agent ends a turn, never while it works, and only numbers not seen before reach GitHub. A chat has no terminal: its conversation is read instead, which is how a bot's workspace shows the pull requests its bot works on. A bot's home is a folder outside Git, so only a GitHub URL or `owner/repo#12` names something there, and what it names that no section can show (merged, closed, or not involving you) is listed under **Mentioned in this workspace**, what is still open first. The back button counts those that arrived since the list last showed them. A bare number of one digit is left out, since "step #1" is prose more often than a reference.

A question an agent asked (Claude Code's `AskUserQuestion`) that names a pull request or an issue stands out more than a mention. Its rows carry a **Question** tag and a coloured bar instead of **Mentioned**, the tabs count them apart from mentions, and a pull request or an issue opened in the panel wears the tag beside its state; hovering the tag quotes the question. The question is heard from Orca's tool hooks, with its exact wording, when it is asked and when it is answered, so nothing is guessed from the screen: it shows the moment the agent stops and goes when you answer. A question you dismiss stays until its agent works again. In a question one digit is enough: "merge #7?" names a pull request. Questions are kept in the plugin's own store, so one asked while you were away is still marked when you come back.

An issue opens in the same panel: its labels and assignees, the pull requests linked to it, its images, description and conversation, and a form to comment, close it as completed or not planned, or reopen it. A pull request names the issues it closes under its branches, one press away.

**Fix with agent**, on the worktree's own pull request, drafts a message for a failing check (with the failing log lines), a merge conflict, or review conversations, lets you edit it and pick an agent of the workspace, then pastes it into that agent's terminal.

## Setup

Requires the GitHub CLI (`gh`) on the Orca machine, signed in with `gh auth login`. Every call goes through `gh` with that account, so the plugin sees what that account can see and acts with its permissions.

## Limits

- The panel has no network: the worker downloads each image from GitHub and hands it over as a data URL, shrinking those over 700 KB with `sips` on macOS. Elsewhere a large image shows as a link to GitHub, and so do videos.
- Merging goes through `gh -R` against the repository and never touches the local checkout. A merge is refused when commits landed after the panel last loaded.
- The panel checks the pull request's state with a small request every 15 seconds while checks run and every 60 seconds otherwise, only while it is visible, and right after a push from the workspace; it slows down to every 15 minutes once the pull request is merged or closed. The full page is fetched again only when that state changed. When GitHub's rate limit is reached, the plugin stops calling GitHub until it resets.
- The timeline shows the last 150 events and the Files tab the first 300 files.
- Opening a pull request in a new worktree works for branches of the same repository, not forks.

## Develop

From the repository root:

```sh
npm install
scripts/orca-types.sh github
npm run typecheck
orca plugin test ./github
orca plugin dev watch ./github
```
