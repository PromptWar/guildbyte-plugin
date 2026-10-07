# Guildbyte 0.3.0

A standard Claude Code plugin installs the mod automatically. Its `AbovePrompt` hook displays your pinned animated Guildbyte character, with a Connect account button and fallback mage when the current account is unpaired or disconnected; no separate mod installation is needed. Requirements: Claude Code 2.1.287+ and Node 22.13+ (built-in SQLite). Implementation follows the [Claude mods guide](https://claude.dev/blog/getting-started-with-claude-code-mods/) and the installed runtime's generated types.

## Connect and test locally

Start the sibling Guildbyte app. Existing databases need migrations `020`, `030`, `031`, `032`, and `033`; a fresh Compose database applies them automatically. Then:

```bash
claude plugin marketplace add PromptWar/guildbyte-plugin
claude plugin install guildbyte@guildbyte --scope user --config appUrl=http://localhost:3000
```

Run `/reload-plugins` or start a new session, then `/guildbyte-connect`. Sign into Guildbyte in the opened browser and claim the ten-minute code. The mod polls the exchange and begins collecting the running session from that moment. `/guildbyte-sync` retries manually. Sign into another Claude subscription, start a new session, and use `/guildbyte-connect` again to link it to the same Guildbyte user. Manage accounts in `/settings`.

On older developer builds, function hooks may need `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`; validation and runtime tests here used Claude 2.1.283 with that flag. Terminal/desktop visuals still need a manual live-session check on 2.1.287+.

## Sync and reinstall behavior

Every paired Claude session scans its own persisted JSONL transcript (main and sidechain files, identified by the session UUID) on activation, prompt submission, completed turns, and every ten seconds. Assistant message IDs identify per-request usage. Newline checkpoints tolerate interrupted writes. Concurrent sessions share SQLite with transactional writes. Uploads contain up to 100 counts and 50 percentage readings per account per cycle. Offline batches stay queued.

Activity uploads contain only numeric observations, IDs, timestamps, account UUID, reported plan, and the model family of each request (`fable`, `opus`, `sonnet`, `haiku`, or `unknown` for any other model), never the prompt. The family is derived locally from the transcript's `message.model`; the raw model id is not stored or uploaded, and the field is only attached to the four token observations. Explicit `/kiss` requests also send the recipient handle; the recipient receives your Guildbyte name, guild and pinned character. No prompt text, code, tool arguments, paths, email, or Claude credentials are uploaded. Keystroke events only reset a local activity timestamp; their text is never retained or uploaded. Claude login identity comes from `claude auth status --json` and the identity fields in Claude's config. API-key authentication is unsupported. Plans and metrics are client-reported, not verified subscription billing.

Local state is stored outside the plugin cache at `~/.claude/guildbyte/<app-origin-hash>/activity.sqlite` (under `CLAUDE_CONFIG_DIR` when set). It holds pairing secrets and installation tokens, is private to the OS user, and survives plugin uninstall/reinstall. Stable observation IDs are deduplicated per Guildbyte user across installations; monotonic snapshots prevent replay from lowering totals. Relinking the same provider UUID reuses one app account. Losing the local database can require pairing again, but imported events retain their stable IDs.

Heartbeat requests run every ten seconds while Claude is active. The app considers an installation online for two minutes after its last heartbeat or batch. No heartbeat means offline, not proof of uninstall. The app polls status every fifteen seconds; setup notices disappear after pairing and remain hidden for previously paired offline installations. Installation tokens expire after ninety days. A 401 clears that account's local token, retains queued data, and asks for `/guildbyte-connect`. Reconnecting replaces expired presence for that account without increasing account count. Other linked accounts may still need reauthentication.

## Live collection starts at pairing

Only activity accepted after a successful pairing counts. The worker records the time each Claude account first pairs and collects nothing before it: no earlier transcripts, no other session's files, and no records that the running session wrote before pairing. Without a pairing nothing is queued. Upgrading from 0.2.x keeps the original collection start of already-paired accounts and drops queued history and unpaired backlog that would otherwise upload. The `importHistory` option is ignored and kept only so existing install commands still work. A 401 keeps queued post-pairing activity for the reconnect.

Token observations use input, output, cache-read, and cache-write counts per assistant request, not the session's context-size gauge. Each of these four counts carries the request's model family so the app can score duels per model; older app servers ignore the field. Progressive snapshots of the same message are merged by maximum value and latest timestamp. The final observed snapshot time assigns a request to `[starts_at, ends_at)`; a request spanning a boundary is not split into a fabricated per-token timeline. Duel settlement retains the app's fifteen-minute upload grace period. Queued live records older than seven days upload as archival history; old readings are discarded. Already settled duels are not reopened for late data.

## Daily gauge, rewards and league notices

The app is authoritative for progression. Every successful observation upload and heartbeat may return a `progression` snapshot (`localDay`, `timeZone`, `effectiveTokens`, `streak { current, longest, multiplier }`, `rewards { gold, chest } { unlocked, claimed }`, `nextThreshold`, `expiresAt`, and optionally `league { division }`, `leagueChange { id, kind, from, to }` and a same-origin `claimUrl` path). The worker validates it, drops unknown or malformed optional fields, keeps the last good snapshot when a response is invalid, and lets the newest local day (then the later expiry) win. It is cached per account in the local database. The plugin computes no thresholds, multipliers, timezones or claim rules; the gauge fills toward the server's `nextThreshold`.

The `AbovePrompt` band shows the cached gauge from session start: `Daily ▰▰▰▰▰▱▱▱▱▱ 8.2M/15M · streak 4 ×1.020`, then one reward icon and a `Claim in Guildbyte ↗` link (default `/leaderboard`) while a reward is unlocked and unclaimed: a yellow coin for gold, replaced by a small chest once the Daily Chest is claimable. If the chest is claimed first, the coin returns until gold is claimed too. Kitty terminals draw it left of the companion; other terminals add it above the status line. The gauge redraws only when what it shows changes. The chest hops between two half-block frames every 500ms, and stays still when Claude's `prefersReducedMotion` setting is on. At `expiresAt` (the next local midnight) the snapshot is no longer shown and every icon clears. A claim in the web app clears its icon on the next sync. The plugin never claims rewards.

Each reward unlock (per local day) and each `leagueChange` id produces one toast, deduplicated across every session that shares the database, and nothing repeats while the state is unchanged. Unlock toasts link to the app. Reward unlocks and promotions appear as soon as a sync returns them; promotions are celebratory (`★ Promoted to Prompt Monkey II! ★`, plus the companion's victory emote). A demotion is never shown mid-session: the worker queues it quietly in the local database and the first sync of the next Claude session start shows a short `League update: now Free Plan Developer I.` once. A later league change replaces a queued demotion, and a promotion drops it. `/guildbyte-status` does not consume the queue. There is no final-warning notification before expiry.

`/guildbyte-status` prints the cached snapshot without contacting the server: day and timezone, effective tokens and the next threshold, streak and multiplier, league, each reward's state, and the claim link and deadline.

The app derives current and longest consecutive-day streaks itself. Opening Claude or heartbeats alone do not qualify. No separate plugin counter is needed.

Limit counters require a real failure: context-window overflow, or a rate-limit failure plus an exhausted five-hour/seven-day reading. Merely approaching 100% does not count. The same account's rate-limit reset window is counted once.

## Kiss visits

Use `/kiss <user_name>` with a Guildbyte handle, optionally prefixed by `@`. The app chooses one most recently active linked session of that player. Your pinned character walks into its band, kisses, then leaves after eight seconds; your name and guild appear above the sprites. Both characters face one another and play one synchronized kiss, then hold the final neutral frame until departure. No prompt or message is inserted into the recipient's conversation.

The server permits one incoming and one outgoing kiss per player at a time, enforces a 15-second sender cooldown, and reserves the recipient's slot for at least eight seconds after delivery. Repeated requests are idempotent. A completed visit is acknowledged by the receiving session, and undelivered visits expire after two minutes. Offline, unknown, busy and unpaired players produce a clear command response. Polling can add up to one heartbeat interval of delivery delay. The app requires `db/019_companion_visits.sql` (already applied locally).

Claude owns the `[-]` collapse control of the `AbovePrompt` band. The current generated mod API provides no option to remove that native control.

## Checks

The companion accepts validated animation frames from the app's fitted pixel-character collection. It walks while Claude thinks or uses tools, returns to the right-hand home position before talking, sits after 20 seconds of inactivity and sleeps after 90 seconds. Sleep plays its transition once and holds the sleeping pose until activity resumes. Idle holds its planted pose, avoiding jumps between misregistered whole-body drawings. Every explicit emote command starts its animation again; kiss plays once, shows a painted heart, returns to neutral and stays there until activity or another command. Typing wakes it immediately. The sprite is up to four rows by eight columns, one-third larger than before, and shrinks to fit narrow terminals. Manual previews last until typing or a new turn; `/guildbyte-idle` resumes automatic activity. Use `/guildbyte-walk`, `/guildbyte-sit`, `/guildbyte-kiss`, `/guildbyte-wave`, `/guildbyte-laugh`, `/guildbyte-angry`, `/guildbyte-victory`, or `/guildbyte-sleep` to preview a state; `/guildbyte-idle` returns to idle. Older servers retain static PNG display. The sprite needs the kitty graphics protocol (kitty, Ghostty, not inside tmux). Other terminals, such as Orca, VS Code and Terminal.app, show a single line instead: `● @handle · 1,234 pts · capturing`, or `N waiting to sync` while records are queued. The app's `/character-lab` previews fitted outfit families, weapon/accessory pairings, fixed sponsor editions and matching head-and-upper-chest portraits. Each item carries rarity; the final character tier comes from its saved item score. Normal recipes are reserved when a chest opens; sponsors stay fixed and ultra rare. The companion uses the same animation clips as the app. Dedicated walk artwork is transported as eight extra frames (28 total); existing 20-frame characters remain supported. Playback samples every 50ms and updates keyed images in place through Claude's image blit API when available, with normal rendering as a fallback. Sleep and kiss still play once and hold their final pose. Anatomy and gait need visual review in addition to payload validation.

```bash
node --no-warnings mods/guildbyte/tests/worker.test.mjs
node mods/guildbyte/tests/progression.test.mjs
node mods/guildbyte/tests/companion-animation.test.mjs
node mods/guildbyte/tests/companion-motion.test.mjs
claude plugin test mods/guildbyte
claude plugin validate mods/guildbyte
```

In the app, run `npm run test:activity`, `npm run test:security`, `npm run test:duel`, `npm run test:guild-duel`, and `npm run typecheck`. The activity check uses a local database and removes its fixture user afterward.
