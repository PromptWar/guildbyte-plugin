# Guildbyte 0.4.0

A standard Claude Code plugin installs the mod automatically. Its `AbovePrompt` hook displays your pinned animated Guildbyte character, with a Connect account button and fallback Cash Cow hero when the current account is unpaired or disconnected; no separate mod installation is needed. Requirements: Claude Code 2.1.287+ and Node 22.13+ (built-in SQLite). Implementation follows the [Claude mods guide](https://claude.dev/blog/getting-started-with-claude-code-mods/) and the installed runtime's generated types.

## Connect and test locally

Start the sibling Guildbyte app. Existing databases need migrations through `db/034_duels_v1.sql`, including `033_manual_hero_levels.sql` for manual evolution; a fresh Compose database applies them automatically. Then:

```bash
claude plugin marketplace add PromptWar/guildbyte-plugin
claude plugin install guildbyte@guildbyte --scope user --config appUrl=http://localhost:3000
```

Run `/reload-plugins` or start a new session, then `/guildbyte-connect`. Sign into Guildbyte in the opened browser and claim the ten-minute code. The mod polls the exchange and begins collecting the running session from that moment. `/guildbyte-sync` retries manually. Sign into another Claude subscription, start a new session, and use `/guildbyte-connect` again to link it to the same Guildbyte user. Manage accounts in `/settings`.

Validation and UI tests passed on Claude Code 2.1.291. If the test runner reports that hooks are disabled by a cached rollout setting, start Claude once with network access and retry. The new commands and hooks require a new session or `/reload-plugins`. Picture animation still needs a live check in a supported graphics terminal.

## Sync and reinstall behavior

Every paired Claude session scans its own persisted JSONL transcript (main and sidechain files, identified by the session UUID) on activation, prompt submission, completed turns, and every ten seconds. Assistant message IDs identify per-request usage. Newline checkpoints tolerate interrupted writes. Concurrent sessions share SQLite with transactional writes. Uploads contain up to 100 counts and 50 percentage readings per account per cycle. Offline batches stay queued.

Activity uploads contain only numeric observations, IDs, timestamps, account UUID, reported plan, and the model family of each request (`fable`, `opus`, `sonnet`, `haiku`, or `unknown` for any other model), never the prompt. The family is derived locally from the transcript's `message.model`; the raw model id is not stored or uploaded, and the field is only attached to the four token observations. Explicit `/kiss` requests also send the recipient handle; the recipient receives your Guildbyte name, guild and pinned character. No prompt text, code, tool arguments, paths, email, or Claude credentials are uploaded. Keystroke events only reset a local activity timestamp; their text is never retained or uploaded. Claude login identity comes from `claude auth status --json` and the identity fields in Claude's config. API-key authentication is unsupported. Plans and metrics are client-reported, not verified subscription billing.

Local state is stored outside the plugin cache at `~/.claude/guildbyte/<app-origin-hash>/activity.sqlite` (under `CLAUDE_CONFIG_DIR` when set). It holds pairing secrets and installation tokens, is private to the OS user, and survives plugin uninstall/reinstall. Stable observation IDs are deduplicated per Guildbyte user across installations; monotonic snapshots prevent replay from lowering totals. Relinking the same provider UUID reuses one app account. Losing the local database can require pairing again, but imported events retain their stable IDs.

Heartbeat requests run every ten seconds while Claude is active. The app considers an installation online for two minutes after its last heartbeat or batch. No heartbeat means offline, not proof of uninstall. The app polls status every fifteen seconds; setup notices disappear after pairing and remain hidden for previously paired offline installations. Installation tokens expire after ninety days. A 401 clears that account's local token, retains queued data, and asks for `/guildbyte-connect`. Reconnecting replaces expired presence for that account without increasing account count. Other linked accounts may still need reauthentication.

## Performance

Terminal paints are serialized and missed ticks coalesce into the latest frame. Typing, prompt submission and model streaming never await animation paints or background sync. Unchanged poses do not repaint. Only moving characters use a wider RGBA canvas; stationary animations retain their smaller PNG frames. Text-only terminals request no artwork and run no animation timer.

Artwork stays in session memory, outside persisted UI state. The worker decodes only walk frames and sends artwork only when its content revision changes; worker responses for unchanged heartbeats carry character metadata. On the current 28-frame hero this reduced decoded pixel data by 57%. Sync remains incremental and allows only one worker at a time, with bounded reads and request/process timeouts.

The native sandbox benchmark below reports canvas construction time and transfer size. It measured about 0.1–0.25 ms per moving frame locally; this excludes Claude's image blit and the terminal's rendering cost. Picture animation still requires a live terminal check on the target computer.

## History and duel windows

Only activity accepted after a successful pairing counts. The worker records the time each Claude account first pairs and collects nothing before it: no earlier transcripts, no other session's files, and no records that the running session wrote before pairing. Without a pairing nothing is queued. Upgrading from 0.2.x keeps the original collection start of already-paired accounts and drops queued history and unpaired backlog that would otherwise upload. The `importHistory` option is ignored and kept only so existing install commands still work. A 401 keeps queued post-pairing activity for the reconnect.

Token observations use input, output, cache-read, and cache-write counts per assistant request, not the session's context-size gauge. Each of these four counts carries the request's model family so the app can score duels per model; older app servers ignore the field. Progressive snapshots of the same message are merged by maximum value and latest timestamp. The final observed snapshot time assigns a request to `[starts_at, ends_at)`; a request spanning a boundary is not split into a fabricated per-token timeline. Duel settlement retains the app's fifteen-minute upload grace period. Queued live records older than seven days upload as archival history; old readings are discarded. Already settled duels are not reopened for late data.

## Daily gauge, rewards and league notices

The app is authoritative for progression. Every successful observation upload and heartbeat may return a `progression` snapshot (`localDay`, `timeZone`, `effectiveTokens`, `streak { current, longest, multiplier }`, `rewards { gold, chest } { unlocked, claimed }`, `nextThreshold`, `expiresAt`, and optionally `league { division }`, `leagueChange { id, kind, from, to }` and a same-origin `claimUrl` path). The worker validates it, drops unknown or malformed optional fields, keeps the last good snapshot when a response is invalid, and lets the newest local day (then the later expiry) win. It is cached per account in the local database. The plugin computes no thresholds, multipliers, timezones or claim rules; the gauge fills toward the server's `nextThreshold`.

The `AbovePrompt` band shows the cached gauge from session start: `Daily ▰▰▰▰▰▱▱▱▱▱ 8.2M/15M · streak 4 ×1.020`, then one reward icon and a `Claim in Guildbyte ↗` link (default `/leaderboard`) while a reward is unlocked and unclaimed: a yellow coin for gold, replaced by a small chest once the Daily Chest is claimable. If the chest is claimed first, the coin returns until gold is claimed too. Kitty terminals draw it left of the companion; other terminals add it above the status line. The gauge redraws only when what it shows changes. On picture-capable terminals the chest hops between two half-block frames every 500ms, and stays still when Claude's `prefersReducedMotion` setting is on; text-only terminals keep it still and run no animation timer. At `expiresAt` (the next local midnight) the snapshot is no longer shown and every icon clears. A claim in the web app clears its icon on the next sync. The plugin never claims rewards.

Each reward unlock (per local day) and each `leagueChange` id produces one toast, deduplicated across every session that shares the database, and nothing repeats while the state is unchanged. Unlock toasts link to the app. Reward unlocks and promotions appear as soon as a sync returns them; promotions are celebratory (`★ Promoted to Prompt Monkey II! ★`, plus the companion's victory emote). A demotion is never shown mid-session: the worker queues it quietly in the local database and the first sync of the next Claude session start shows a short `League update: now Free Plan Developer I.` once. A later league change replaces a queued demotion, and a promotion drops it. `/guildbyte-status` does not consume the queue. There is no final-warning notification before expiry.

`/guildbyte-status` prints the cached snapshot without contacting the server: day and timezone, effective tokens and the next threshold, streak and multiplier, league, each reward's state, and the claim link and deadline.

The app derives current and longest consecutive-day streaks itself. Opening Claude or heartbeats alone do not qualify. No separate plugin counter is needed.

Limit counters require a real failure: context-window overflow, or a rate-limit failure plus an exhausted five-hour/seven-day reading. Merely approaching 100% does not count. The same account's rate-limit reset window is counted once.

## Duels

`/duel` runs player and guild duels from the CLI. The app is authoritative: it checks eligibility, privacy, Battle Energy, gold and cooldowns, and returns every display field and allowed action (`you.canAccept`, `you.confirm`, `potGold`, `energy.nextAt`…). The plugin parses the command, makes at most one read and one write through the worker with the installation token, and prints the reply with the web link the server returns. Response shapes mirror the app's `lib/duel-contract.ts` in `types/index.d.ts`.

```text
/duel                              dashboard: requests, active duels, energy
/duel @alice 6h 25                 challenge (0 gold = exhibition)
/duel @a @b @c 1d 10               free-for-all invitation (up to 7 handles)
/duel lobby 4 1d 10                open lobby with a join link
/duel join <link>                  preview, then add confirm to join
/duel view|accept|decline|cancel|leave|forfeit <code>
/duel energy [buy]                 Battle Energy (1,000 gold each)
/duel link [on|off|1h…7d|regenerate]  your public exhibition link
/duel guild                        your guild's duels and record
/duel guild @rivals 5 25           declare: team size 2-10, stake per member, 7 days
/duel guild view|accept|decline|cancel <code>
/duel guild roster <code> [add|remove @handle]
/duel guild ready|unready|decline-selection <code>
```

Durations are `1h`, `6h`, `1d`, `3d` and `7d`. A wager is a whole number of gold or `all`. Codes are six characters (`Q7KM2P`) and are case-insensitive. A stake above 100 gold needs `confirm` and a whole-balance stake needs `allin`. Accept, join and guild Ready read the server's own `confirm` requirement before staking. `/duel forfeit` needs `confirm`, and `/duel energy buy` needs `confirm` too. Where the surface places a pane, `/duel @handle`, guild declarations, roster edits and every confirmation open an interactive panel (duration and wager buttons, `[Cancel] [Send challenge]`, `[Keep fighting] [Forfeit]`). The panel runs the same typed command. Surfaces without panes get the typed reply, which names the command to rerun. A 409 "Pair Guildbyte first" prints the server's setup link, and a 401 asks for `/guildbyte-connect`.

Heartbeats from a Duels v1 server carry `duels { badge, energy, requests }`. The worker validates each request (kind, six-character code, printable sender, positive duration, non-negative wager, expiry) and drops invalid ones. It caches them per account. Each new request toasts once across every session that shares the local database, under the id `duel-request:<kind>:<code>`. The toast shows the challenger, duration, stake and expiry, plus the accept and decline commands (`ready` and `decline-selection` for a guild roster pick). Expired requests are never shown. A server without Duels v1 sends no `duels` field, and the cache is left as it was. Plugins older than 0.4.0 ignore the field. Their heartbeat status is identical with or without it.

## Kiss visits

Use `/kiss <user_name>` with a Guildbyte handle, optionally prefixed by `@`. The app chooses one most recently active linked session of that player. Your pinned character walks into its band, kisses, then leaves after eight seconds; your name and guild appear above the sprites. Both characters face one another and play one synchronized kiss, then hold the final neutral frame until departure. No prompt or message is inserted into the recipient's conversation.

The server permits one incoming and one outgoing kiss per player at a time, enforces a 15-second sender cooldown, and reserves the recipient's slot for at least eight seconds after delivery. Repeated requests are idempotent. A completed visit is acknowledged by the receiving session, and undelivered visits expire after two minutes. Offline, unknown, busy and unpaired players produce a clear command response. Polling can add up to one heartbeat interval of delivery delay. The app requires `db/019_companion_visits.sql` (already applied locally).

Claude owns the `[-]` collapse control of the `AbovePrompt` band. The current generated mod API provides no option to remove that native control.

## Checks

The companion accepts validated animation frames from the app's fitted pixel-character collection. It walks while Claude thinks or uses tools, returns to the right-hand home position before talking, sits after 20 seconds of inactivity and sleeps after 90 seconds. Sleep plays its transition once and holds the sleeping pose until activity resumes. Idle holds its planted pose, avoiding jumps between misregistered whole-body drawings. Every explicit emote command starts its animation again; kiss plays once, shows a painted heart, returns to neutral and stays there until activity or another command. Typing wakes it immediately. The hero is up to four rows by eight columns and shrinks to fit narrow terminals. The level-up spell expands to twelve columns by six rows when space permits, keeping the hero in front of the surrounding magic. Manual previews last until typing or a new turn; `/guildbyte-idle` resumes automatic activity. Use `/guildbyte-walk`, `/guildbyte-sit`, `/guildbyte-kiss`, `/guildbyte-wave`, `/guildbyte-laugh`, `/guildbyte-angry`, `/guildbyte-victory`, or `/guildbyte-sleep` to preview a state; `/guildbyte-idle` returns to idle. Older servers retain static PNG display. The sprite needs the kitty graphics protocol (kitty, Ghostty, not inside tmux). Other terminals, such as Orca, VS Code and Terminal.app, show a single line instead: `● @handle · 1,234 pts · capturing`, or `N waiting to sync` while records are queued. The app's `/character-lab` previews all twenty-one heroes and their five evolutions, all animation states, head-and-upper-chest portraits and shared gold level-up aura. Full hero skins are authored together; there is no trait mixing. A chest grants level 1. XP stops at each level cap until the player explicitly evolves; level 5 earns no more XP. Use `/guildbyte-levelup [1-5] [hero_id]` to replay the gold aura locally without changing earned XP. Current heroes use 16 core poses plus twelve fitted walk drawings at 100ms per frame (28 frames). Both legs alternate with a small body bob and free-arm swing; the loaded hand keeps its grip. Terminal patrol moves inside a stationary native pixel canvas, keeping sub-column positions instead of jumping between terminal cells. Patrol and kiss visits update the canvas in place; delayed paints run sequentially and coalesce missed ticks. The existing Node worker decodes the bounded RGBA PNG exports and streams pixels into hook memory, outside persisted plugin state. Unsupported legacy PNG formats animate in place. Terminal patrol moves at 1.6 columns per second to match the carrying stride. Talking uses closed, partial and open mouth artwork with the face and feet fixed. Kiss includes an actual head lean and return, with a painted heart at the peak. Legacy 20/24/32-frame payloads remain supported. Playback samples every 50ms and updates keyed images in place through Claude's image blit API when available, with normal rendering as a fallback. Sleep and kiss still play once and hold their final pose. Anatomy and gait need visual review in addition to payload validation.

```bash
node --no-warnings mods/guildbyte/tests/worker.test.mjs
node mods/guildbyte/tests/progression.test.mjs
node mods/guildbyte/tests/companion-animation.test.mjs
node mods/guildbyte/tests/companion-motion.test.mjs
node --no-warnings mods/guildbyte/tests/duel-format.test.mjs
node --no-warnings mods/guildbyte/tests/duel-worker.test.mjs
node --no-warnings mods/guildbyte/tests/duel-notices.test.mjs
node mods/guildbyte/tests/companion-loading.test.mjs
node mods/guildbyte/tests/companion-feedback.test.mjs
node mods/guildbyte/tests/decode-companion.test.mjs
claude plugin test mods/guildbyte
claude plugin validate mods/guildbyte
```

For roster integration in the app, run `npm run test:character-roster`, `npm run test:character-ownership`, `npm run test:companion-visits`, and `npm run test:characters`. These check all twenty-one hero identities, deterministic rarity rolls, persistent XP/ownership, authenticated previews, and exported 105-skin animation payloads.

In the app, run `npm run test:activity`, `npm run test:security`, `npm run test:duel`, `npm run test:guild-duel`, `npm run test:duel-v1`, `npm run test:guild-duel-v1`, `npm run test:duel-settlement`, and `npm run typecheck`. The Duels v1 scripts print PENDING until `034` is applied. The activity check uses a local database and removes its fixture user afterward.

### Hero evolution preview

`/guildbyte-levelup` previews the next skin; `/guildbyte-levelup 5` previews the pinned hero’s final evolution; `/guildbyte-levelup 5 iris_archon` previews another approved hero without pinning it. This plays the larger shared gold/ivory spell once for two seconds, with floor runes, rising ribbons and a burst above the hero, and keeps earned XP unchanged. Run it again to restart. Evolution is never automatic. Press **Level up** in the action frame when the bar is full, or run `/guildbyte-evolve`, to unlock exactly one skin and play the aura at the current patrol position. Overflow is discarded; level 5 is capped at 1,600 XP. `/guildbyte-kiss` paints a pixel heart, plays once, and restarts when invoked again.

Initial data loading shows an eight-frame pixel loader at 5 FPS, with no placeholder hero or Connect action. After a confirmed disconnected response, **Connect account** appears. Actions share a gold double-border frame using the app palette; the frame is absent when no actions are available. Compact bands retain a single action row. The hero remains below the action area, preserving its floor anchor.

Fresh XP gains appear as purple pixel text that rises and fades over 1.8 seconds while following the hero. The first response and hero switches establish a baseline without replaying historical XP. This reuses the existing graphics animation clock; text-only terminals stop the loader clock after loading and retain their normal activity status/actions. No terminal-specific focus API or adapter is used. `/guildbyte-levelup` remains a visual preview; `/guildbyte-evolve` changes the earned level.
