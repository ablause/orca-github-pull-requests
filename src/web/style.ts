// Orca's own sidebar views, measured on its native Checks panel: the sidebar surface (`--card`,
// #171717) rather than the window background, 12 px text with 11 and 10 px metadata, circled
// status icons, uppercase section labels with count pills, segmented tabs on a darker track, and
// bordered cards for comments. Fallbacks only show before Orca's tokens arrive.
export const STYLES = `
:root {
  --surface: var(--orca-card, #171717);
  --track: var(--orca-background, #0a0a0a);
  --fg: var(--orca-card-foreground, var(--orca-foreground, #f0f0f0));
  --muted-fg: var(--orca-muted-foreground, #acacac);
  --muted: var(--orca-muted, #262626);
  --hover: var(--orca-accent, #404040);
  --border: var(--orca-border, #ffffff12);
  --input: var(--orca-input, #ffffff26);
  --primary: var(--orca-primary, #e5e5e5);
  --primary-fg: var(--orca-primary-foreground, #171717);
  --destructive: var(--orca-destructive, #ff6568);
  --ring: var(--orca-ring, #a1a1a1);
  --radius: 6px;
  --success: #22c55e;
  --success-text: #4ade80;
  --merge: #16a34a;
  --merge-hover: #15803d;
  --warning: #eab308;
  --merged: #a78bfa;
  --asked: var(--warning);
  color-scheme: dark;
}
:root.light {
  --success: #16a34a;
  --success-text: #147638;
  --warning: #ca8a04;
  --merged: #7c3aed;
  /* the bar and icons of a question are thin marks: on a light ground they need more than the fill's amber */
  --asked: #a16207;
  color-scheme: light;
}
* { box-sizing: border-box; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--muted-fg) 30%, transparent); border: 3px solid transparent; border-radius: 999px; background-clip: padding-box; }
::-webkit-scrollbar-thumb:hover { background-color: color-mix(in srgb, var(--muted-fg) 50%, transparent); }
::-webkit-scrollbar-corner { background: transparent; }
html, body { margin: 0; background: var(--surface); color: var(--fg); }
body {
  font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
button, select, textarea, input { font: inherit; color: inherit; }
code, pre, .mono { font-family: "SF Mono", SFMono-Regular, ui-monospace, Menlo, monospace; }
a { color: inherit; }
.icon { flex: none; display: block; }
.muted { color: var(--muted-fg); }
.xs { font-size: 11px; }
.xxs { font-size: 10px; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.grow { flex: 1; min-width: 0; }
.row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.wrap { flex-wrap: wrap; }
.stack { display: flex; flex-direction: column; gap: 10px; }
.tone-success { color: var(--success); }
.tone-danger { color: var(--destructive); }
.tone-warning { color: var(--warning); }
.tone-done { color: var(--merged); }
.tone-neutral { color: var(--muted-fg); }
.add { color: var(--success-text); }
.del { color: var(--destructive); }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }

main { padding: 0 10px 16px; }

/* section labels, as Orca's COMMENTS heading */
.section-head { display: flex; align-items: center; gap: 6px; color: var(--fg); }
.section-label { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; margin: 0; }
.pill { min-width: 18px; height: 16px; padding: 0 5px; border-radius: 999px; background: var(--muted); color: var(--muted-fg); font-size: 10px; line-height: 16px; text-align: center; font-variant-numeric: tabular-nums; }
.pill.accent { background: var(--primary); color: var(--primary-fg); margin-left: 4px; }
.tag { display: inline-flex; align-items: center; gap: 3px; height: 16px; padding: 0 5px; border-radius: 3px; background: var(--muted); color: var(--fg); font-size: 10px; font-weight: 500; white-space: nowrap; }
.tab .tag { margin-left: 2px; }
.tag.asked { background: color-mix(in srgb, var(--warning) 22%, transparent); }
.tag.asked .icon { color: var(--asked); }
.pr-id .tag { height: 16px; }

/* the state badge, as Orca's OPEN */
.badge { display: inline-flex; align-items: center; height: 16px; padding: 0 5px; border-radius: 3px; font-size: 9px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; border: 1px solid; }
.badge.success { color: var(--success-text); border-color: color-mix(in srgb, var(--success) 35%, transparent); background: color-mix(in srgb, var(--success) 12%, transparent); }
.badge.done { color: var(--merged); border-color: color-mix(in srgb, var(--merged) 35%, transparent); background: color-mix(in srgb, var(--merged) 12%, transparent); }
.badge.danger { color: var(--destructive); border-color: color-mix(in srgb, var(--destructive) 35%, transparent); background: color-mix(in srgb, var(--destructive) 12%, transparent); }
.badge.neutral { color: var(--muted-fg); border-color: var(--input); background: var(--muted); }

/* buttons */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 24px; padding: 0 8px;
  border-radius: 4px; border: 1px solid transparent; background: transparent; font-size: 11px; font-weight: 500;
  white-space: nowrap; cursor: pointer;
}
button:focus-visible, a:focus-visible { outline: 1px solid var(--ring); outline-offset: 1px; }
.btn:disabled, .icon-btn:disabled { opacity: .5; cursor: default; }
.btn.primary { background: var(--primary); color: var(--primary-fg); }
.btn.primary:hover:not(:disabled) { opacity: .9; }
.btn.outline { border-color: var(--input); }
.btn.outline:hover:not(:disabled), .btn.ghost:hover:not(:disabled) { background: var(--muted); }
.btn.merge { background: var(--merge); color: #fff; }
.btn.merge:hover:not(:disabled) { background: var(--merge-hover); }
.btn.danger { background: var(--destructive); color: #fff; }
.btn.danger-text { color: var(--destructive); }
.btn.sm { height: 22px; padding: 0 7px; }
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; flex: none;
  border-radius: 4px; border: 0; background: transparent; color: var(--muted-fg); cursor: pointer;
}
.icon-btn:hover:not(:disabled) { background: var(--muted); color: var(--fg); }
.icon-btn.asked, .icon-btn.asked:hover:not(:disabled) { color: var(--asked); }
select, textarea {
  width: 100%; background: var(--track); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 6px 8px; font-size: 12px;
}
select { height: 24px; padding: 0 6px; font-size: 11px; }
textarea { resize: vertical; min-height: 56px; }
textarea:focus, select:focus { outline: none; border-color: var(--ring); }

/* header */
.topbar { position: sticky; top: 0; z-index: 2; background: var(--surface); display: flex; align-items: center; gap: 2px; margin: 0 -4px; padding: 6px 0; }
.topbar .back { padding: 0 4px; color: var(--muted-fg); }
.topbar .back:hover { color: var(--fg); }
.header { padding: 2px 0 10px; display: flex; flex-direction: column; gap: 6px; }
.pr-id { display: flex; align-items: center; gap: 8px; }
.pr-id .number { font-size: 13px; font-weight: 600; }
h1 { font-size: 13px; font-weight: 600; line-height: 1.45; margin: 0; overflow-wrap: anywhere; }
.branches { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; font-size: 10px; color: var(--muted-fg); }
.meta-row { display: flex; align-items: center; gap: 4px 8px; flex-wrap: wrap; }
.label { display: inline-flex; align-items: center; gap: 4px; height: 18px; padding: 0 6px; border: 1px solid var(--border); border-radius: 999px; font-size: 10px; }
.label .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.linked { display: flex; flex-direction: column; gap: 2px; font-size: 11px; }
.linked > .muted { font-size: 10px; }
.linked-item { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 2px 4px; margin: 0 -4px; border: 0; border-radius: 4px; background: transparent; cursor: pointer; text-align: left; }
.linked-item:hover { background: var(--muted); }
.state-tabs { display: flex; gap: 12px; align-items: center; font-size: 11px; }
.state-tabs { gap: 4px; margin-left: -6px; }
.state-tabs button { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 6px; border: 0; border-radius: 4px; background: none; cursor: pointer; color: var(--muted-fg); font-weight: 500; }
.state-tabs button[aria-pressed="true"] { color: var(--fg); background: var(--muted); font-weight: 600; }
.list.pin { padding-bottom: 6px; border-bottom: 1px solid var(--border); }
.mark { display: inline-flex; }
.state-tabs button:hover { color: var(--fg); }
.ref { font-family: "SF Mono", ui-monospace, Menlo, monospace; font-size: 10px; background: var(--muted); border-radius: 3px; padding: 0 4px; color: var(--fg); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* status card: its head is the bar Orca puts over a check group */
.status { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.status-head { display: flex; align-items: center; gap: 8px; padding: 4px 4px 4px 8px; min-height: 32px; background: color-mix(in srgb, var(--muted) 55%, transparent); }
.status-head .summary { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; background: none; border: 0; padding: 0; cursor: pointer; text-align: left; font-size: 11px; font-weight: 500; }
.status-head .summary:disabled { cursor: default; }
.status-body { border-top: 1px solid var(--border); padding: 2px 0; }
.status-line { display: flex; align-items: flex-start; gap: 8px; padding: 6px 10px; font-size: 12px; }
.status-line .icon { margin-top: 2px; }
.status-line .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.status-foot { border-top: 1px solid var(--border); padding: 8px 10px; display: flex; flex-direction: column; gap: 8px; }

/* segmented tabs on a darker track, as Orca's All / Humans / Bots */
.tabs { display: flex; gap: 2px; padding: 2px; background: var(--track); border: 1px solid var(--border); border-radius: var(--radius); overflow-x: auto; }
.tab { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 24px; padding: 0 8px; border: 0; border-radius: 4px; background: transparent; color: var(--muted-fg); font-size: 11px; font-weight: 500; cursor: pointer; white-space: nowrap; }
.tab:hover { color: var(--fg); }
.tab.active { background: var(--muted); color: var(--fg); }
.count { font-size: 11px; font-variant-numeric: tabular-nums; }

/* list rows, as Orca's check rows */
.list { display: flex; flex-direction: column; margin: 0 -4px; }
.list-row {
  display: flex; align-items: center; gap: 8px; width: 100%; min-height: 32px; padding: 4px; border: 0; border-radius: 4px;
  background: transparent; text-align: left; cursor: pointer;
}
.list-row:hover:not(:disabled) { background: var(--muted); }
.list-row:disabled { cursor: default; }
.list-row .body { display: flex; flex-direction: column; gap: 0; flex: 1; min-width: 0; }
.list-row .primary { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list-row .secondary { font-size: 10px; color: var(--muted-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list-row.current { background: var(--muted); }
.list-row.asked { position: relative; }
.list-row.asked::before { content: ""; position: absolute; left: -4px; top: 6px; bottom: 6px; width: 2px; border-radius: 1px; background: var(--asked); }
.list-row .side { font-size: 11px; color: var(--muted-fg); white-space: nowrap; display: flex; gap: 6px; align-items: center; }

/* conversation: bordered cards, as Orca's comment cards */
.timeline { display: flex; flex-direction: column; gap: 8px; }
.card { border: 1px solid var(--border); border-radius: var(--radius); }
.card-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; }
.card-head .who { display: flex; flex-direction: column; min-width: 0; }
.card-head .who strong { font-size: 12px; font-weight: 600; }
.card-head .who span { font-size: 10px; color: var(--muted-fg); }
.card-body { border-top: 1px solid var(--border); padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 8px; }
.avatar { width: 20px; height: 20px; border-radius: 50%; flex: none; background: var(--muted); display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; color: var(--muted-fg); overflow: hidden; }
.avatar img { width: 100%; height: 100%; display: block; }
.event { display: flex; align-items: flex-start; gap: 8px; padding: 2px 10px; font-size: 11px; color: var(--muted-fg); }
.event .icon { margin-top: 2px; }
.event strong { color: var(--fg); font-weight: 500; }
.clamp { position: relative; max-height: 300px; overflow: hidden; }
.clamp::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 44px; background: linear-gradient(transparent, var(--surface)); }
.reactions { display: flex; gap: 4px; flex-wrap: wrap; }
.chip { height: 20px; border: 1px solid var(--border); border-radius: 999px; background: transparent; padding: 0 7px; font-size: 10px; cursor: pointer; color: var(--muted-fg); }
.chip.mine { border-color: var(--ring); color: var(--fg); background: var(--muted); }
.thread { border: 1px solid var(--border); border-radius: var(--radius); }
.thread-head { display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 8px; border: 0; background: transparent; cursor: pointer; text-align: left; font-size: 11px; }
.thread-head:hover { background: var(--muted); }
.thread-head .chev { color: var(--muted-fg); }
.thread-body { border-top: 1px solid var(--border); padding: 8px; display: flex; flex-direction: column; gap: 10px; }
.thread-comment { display: flex; flex-direction: column; gap: 4px; }
.thread-comment .meta { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--muted-fg); }
.thread-comment .meta strong { color: var(--fg); font-size: 11px; }
.composer { display: flex; flex-direction: column; gap: 6px; padding-top: 4px; }
.fix { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.drawer { width: 100%; display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--track); }
.notice { margin: 0; padding: 6px 10px; border-radius: var(--radius); font-size: 11px; border: 1px solid var(--border); }
.notice.danger { border-color: color-mix(in srgb, var(--destructive) 30%, transparent); background: color-mix(in srgb, var(--destructive) 10%, transparent); color: var(--destructive); }
.notice.success { border-color: color-mix(in srgb, var(--success) 25%, transparent); background: color-mix(in srgb, var(--success) 10%, transparent); }
.notice.warning { border-color: color-mix(in srgb, var(--warning) 25%, transparent); background: color-mix(in srgb, var(--warning) 10%, transparent); }
.empty { padding: 24px 8px; text-align: center; color: var(--muted-fg); font-size: 12px; margin: 0; }

/* image strip */
.images { display: flex; flex-direction: column; gap: 6px; }
.strip { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
.thumb { flex: none; height: 88px; min-width: 56px; max-width: 150px; padding: 0; border: 1px solid var(--border); border-radius: var(--radius); background: var(--track); overflow: hidden; cursor: zoom-in; display: flex; align-items: center; justify-content: center; }
.thumb img { height: 100%; width: auto; max-width: 150px; object-fit: cover; display: block; }
.thumb:hover { border-color: var(--ring); }

/* diffs */
.diff { margin: 0; overflow-x: auto; font-size: 10.5px; line-height: 1.6; border: 1px solid var(--border); border-radius: var(--radius); background: var(--track); }
.diff .line { display: block; white-space: pre; padding: 0 8px; }
.diff .add { background: color-mix(in srgb, var(--success) 14%, transparent); color: inherit; }
.diff .del { background: color-mix(in srgb, var(--destructive) 14%, transparent); color: inherit; }
.diff .hunk { color: var(--muted-fg); }
.file-status { width: 12px; text-align: center; font-size: 10px; font-weight: 700; flex: none; }

/* GitHub's rendered bodies, in Orca's type */
.markdown-body { font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; }
.markdown-body > :first-child { margin-top: 0; }
.markdown-body > :last-child { margin-bottom: 0; }
.markdown-body p, .markdown-body ul, .markdown-body ol, .markdown-body table, .markdown-body pre, .markdown-body blockquote, .markdown-body details { margin: 0 0 8px; }
.markdown-body h1, .markdown-body h2, .markdown-body h3 { font-size: 12px; font-weight: 600; margin: 12px 0 4px; }
.markdown-body h4, .markdown-body h5, .markdown-body h6 { font-size: 11px; font-weight: 600; margin: 10px 0 4px; color: var(--muted-fg); }
.markdown-body ul, .markdown-body ol { padding-left: 18px; }
.markdown-body li + li { margin-top: 2px; }
.markdown-body a { color: var(--fg); text-decoration: underline; text-decoration-color: var(--muted-fg); text-underline-offset: 2px; }
.markdown-body code { font-size: 11px; background: var(--muted); border-radius: 3px; padding: 1px 4px; }
.markdown-body pre { background: var(--track); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px; overflow-x: auto; font-size: 11px; }
.markdown-body pre code { background: none; padding: 0; }
.markdown-body blockquote { border-left: 2px solid var(--input); padding-left: 10px; color: var(--muted-fg); }
.markdown-body table { border-collapse: collapse; display: block; overflow-x: auto; font-size: 11px; }
.markdown-body th, .markdown-body td { border: 1px solid var(--border); padding: 3px 7px; }
.markdown-body th { background: var(--muted); font-weight: 600; }
.markdown-body hr { border: 0; border-top: 1px solid var(--border); }
.markdown-body details > summary { cursor: pointer; }
.markdown-body .task-list-item { list-style: none; }
.markdown-body .contains-task-list { padding-left: 2px; }
.markdown-body .markdown-alert { border-left: 2px solid var(--ring); padding: 2px 10px; margin-bottom: 8px; }
.markdown-body .markdown-alert-warning, .markdown-body .markdown-alert-caution { border-left-color: var(--warning); }
.markdown-body .user-mention, .markdown-body .team-mention { font-weight: 600; text-decoration: none; }
.markdown-body img { max-width: 100%; height: auto; border-radius: 4px; cursor: zoom-in; vertical-align: middle; border: 1px solid var(--border); }
.markdown-body img.loading { min-width: 64px; min-height: 40px; background: var(--muted); }
.markdown-body img.failed { cursor: pointer; min-height: 24px; padding: 4px; border-style: dashed; }
.markdown-body .pl-k, .markdown-body .pl-en { color: #ff7b72; }
.markdown-body .pl-s, .markdown-body .pl-pds { color: #a5d6ff; }
.markdown-body .pl-c { color: var(--muted-fg); }
.markdown-body .pl-c1, .markdown-body .pl-v { color: #79c0ff; }
.markdown-body .pl-smi, .markdown-body .pl-ent { color: #7ee787; }
:root.light .markdown-body .pl-k, :root.light .markdown-body .pl-en { color: #cf222e; }
:root.light .markdown-body .pl-s, :root.light .markdown-body .pl-pds { color: #0a3069; }
:root.light .markdown-body .pl-c1, :root.light .markdown-body .pl-v { color: #0550ae; }
:root.light .markdown-body .pl-smi, :root.light .markdown-body .pl-ent { color: #116329; }

/* small pieces */
.chev { transition: transform .15s; }
.chev.open { transform: rotate(90deg); }
@media (prefers-reduced-motion: reduce) { .chev { transition: none; } }
.commit-line { display: flex; align-items: center; gap: 8px; width: 100%; padding: 1px 0; border: 0; background: none; cursor: pointer; text-align: left; font-size: 11px; color: var(--fg); }
.commit-line:hover .truncate { text-decoration: underline; }

/* image viewer */
.lightbox { position: fixed; inset: 0; background: var(--surface); display: flex; flex-direction: column; z-index: 10; padding: 8px; gap: 8px; }
.lightbox-bar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; }
.zoom-controls { gap: 2px; }
.zoom-level { width: 48px; padding: 0; font-variant-numeric: tabular-nums; }
.lightbox-stage { flex: 1; min-height: 0; overflow: auto; display: flex; position: relative; }
.lightbox-stage > p { margin: auto; }
.lightbox-failed { margin: auto; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.lightbox-stage img { margin: auto; flex: none; max-width: none; cursor: zoom-in; user-select: none; -webkit-user-drag: none; }
.lightbox-stage img.pending { position: absolute; visibility: hidden; }
.lightbox-stage.zoomed img { cursor: grab; }
.lightbox-stage.dragging, .lightbox-stage.dragging img { cursor: grabbing; }
`
