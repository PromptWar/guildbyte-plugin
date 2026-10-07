# Guildbyte Claude plugin

The `guildbyte` plugin installs a mod with the animated pixel-art character above Claude's prompt, account pairing, and numeric activity sync. The web app/API live in the sibling `guildbyte-app` repository.

Use Claude Code 2.1.287+ and Node 22.13+. Install the public marketplace:

```bash
claude plugin marketplace add PromptWar/guildbyte-plugin && claude plugin install guildbyte@guildbyte --scope user --config appUrl=http://localhost:3000 --config importHistory=true
```

Replace the app URL with your HTTPS deployment. Run `/reload-plugins`, then `/guildbyte-connect` and confirm the code in the browser. For a local checkout, replace `PromptWar/guildbyte-plugin` with this repository's absolute path. The app's `/setup` page generates the command with its own URL.

See [the plugin guide](mods/guildbyte/README.md) for synchronization, historical import, account switching, and tests.

The companion band uses three areas: visiting heroes on the left, conditional action buttons in a centered gold frame that fits their contents, and the player with a bounded patrol on the right. Narrow terminals put the centered action row above the heroes. XP metadata sits outside the button frame. Only changed keyed images are sent; idle sends no image updates. Stream-triggered paints share the same 80 ms budget as timer ticks. Unchanged host redraws reuse one composed image per artwork object, including XP and aura overlays. Paints never overlap or queue catch-up redraws, and prompt edits never await image work or spawn workers. Periodic sync waits for a pause in typing; explicit sync and activity uploads still run normally.

Run `node mods/guildbyte/tests/companion-input-performance.test.mjs` to replay 200 thinking/text transitions per second, verify held images are not re-encoded on repeated host redraws, and check all ten animation states plus the loader, XP, aura and visitor emit zero image updates, prompt-band state writes and periodic worker launches during typing, quiet idle, and one paint in flight under a slow image transport. The native compositor benchmark excludes terminal/GPU rendering and cannot certify end-to-end typing latency on every computer.
