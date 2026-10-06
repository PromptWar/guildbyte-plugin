# Guildbyte Claude plugin

The `guildbyte` plugin installs a mod with the animated pixel-art character above Claude's prompt, account pairing, and numeric activity sync. The web app/API live in the sibling `guildbyte-app` repository.

Use Claude Code 2.1.287+ and Node 22.13+. Install the public marketplace:

```bash
claude plugin marketplace add PromptWar/guildbyte-plugin && claude plugin install guildbyte@guildbyte --scope user --config appUrl=http://localhost:3000
```

Replace the app URL with your HTTPS deployment. Run `/reload-plugins`, then `/guildbyte-connect` and confirm the code in the browser. For a local checkout, replace `PromptWar/guildbyte-plugin` with this repository's absolute path. The app's `/setup` page generates the command with its own URL.

See [the plugin guide](mods/guildbyte/README.md) for synchronization, the daily gauge and reward notices, account switching, and tests.
