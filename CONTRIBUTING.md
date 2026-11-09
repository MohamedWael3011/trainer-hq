# Contributing to Trainer HQ

Thanks for wanting to help the party grow. 🥚

## Run it locally

```bash
npm install
npm run dev        # hot-reloading app
npm run typecheck  # main + renderer
npm run smoke      # builds, launches, saves a PNG of each window to out/smoke/, quits
```

You need macOS, Node 20+, and the [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI signed in.

## House rules

- **No comments in source files.** Make the code say it with names; put the why in the PR description or `docs/`.
- **No magic strings.** Discriminants (statuses, kinds, modes, IPC channels) come from `as const` objects in `src/shared/constants.ts`, and their types are derived from them.
- **One folder per component**, each with its own `styles.css`. No inline `style={{}}`.
- **Motion** follows the rules in Emil Kowalski's design-engineering skill: custom curves, under 300 ms for UI, nothing animated on keyboard actions, `scale(0.97)` on press, hover effects only for fine pointers.
- **Keep the core generic.** Anything about a specific company, app or codebase belongs in a user's vault (creatures, notes, `profile.yaml`), never in `src/`.
- **Art you add must be redistributable** (CC0, CC BY, CC BY-SA, OFL...). Credit it in `THIRD_PARTY_NOTICES.md`. No Nintendo or other copyrighted sprites in the repo.

## Pull requests

1. Fork, branch from `main`, keep the change focused.
2. `npm run typecheck` and `npm run smoke` pass.
3. Describe what changed and why, with a screenshot or GIF for UI changes.

## Good first quests

- New engine adapters (`src/main/engines/`)
- New Lab adapters for other render harnesses (`src/main/lab.ts`)
- More original pixel creatures (with a free license) and dock decorations
- Windows and Linux support for the overlays
