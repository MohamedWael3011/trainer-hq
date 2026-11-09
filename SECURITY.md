# Security

Trainer HQ runs AI agents that can read and change files on your machine, so security reports matter.

## Reporting

Please **don't open a public issue**. Use GitHub's private reporting: **Security → Report a vulnerability** on this repository. You'll get an answer within a few days.

## How the app is built to be safe

- Agents run through your own `claude` CLI login. Trainer HQ never stores API keys or passwords.
- Approvals go through a local MCP server bound to `127.0.0.1` with a random per-launch token.
- Full auto always keeps a built-in deny list (`git push`, `git reset --hard`, `git clean`, `git merge`, `git rebase`, `rm -rf`, `sudo`, `.env` reads), a time limit and a plan-usage limit.
- Files served to the UI (sprites, lab renders) are restricted to known folders.

Things worth reporting: ways to bypass the deny list or approvals, reading files outside the allowed folders, or the local server accepting requests without the token.
