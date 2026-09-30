# LEJ Claude Session Board

A Claude Code skill for running a lot of Claude Code sessions in one project without losing track of them.

One session becomes the **manager**. Every other session in the project folder reports to it: when it starts something, when it needs you, before it touches shared code or deploys, and when it's done. The manager keeps one page current, the **LEJ Session Board**:

- **A section per open session:** what it's doing, where it stands, and any question it has for you, right there in the same section.
- **Recommended answers:** each question has two or three options with one marked Recommended. Picking one fills a reply you can edit. Copy puts the session's name and `Re: <question>` above your reply, so the manager knows where it goes and the session knows what you're answering. Paste it in the session, or paste a batch back to the manager and it relays each one.
- **The to-do list:** grouped by who acts. Every item Claude can build has a numbered starter prompt (`PRJ5 Short name`) to copy into a new session, title included.
- **Per-item copy marks:** each copy button turns into "✓ Copied", so you can see which replies and prompts you've already used.

It uses Claude Desktop's session tools, so it runs in the **Code tab of the Claude desktop app**.

## Install

```bash
git clone https://github.com/justfinethanku/lej-claude-session-board.git ~/.claude/skills/lej-session-board
```

Then in a Claude Code desktop session in your project folder, say something like "be the manager for this folder and make me a session board", or "which of my sessions are stale?"

## What's inside

| Path | What it is |
|---|---|
| `SKILL.md` | The instructions Claude follows: roster, hub setup, building the board, keeping it current. |
| `assets/board-template.html` | The board page, rendered from a JSON block. Example data included. |
| `references/data-schema.md` | The JSON fields the page reads. |
| `references/coordination-rule.md` | The `CLAUDE.md` block that makes sessions report to the manager. |

## Look

LEJ branding: Bricolage Grotesque, Hanken Grotesk and JetBrains Mono. Terracotta on soft white, with charcoal text and a matching dark mode. Color marks only what needs you and the main actions.

Made by Jonathan Edwards ([Limited Edition Jonathan](https://limitededitionjonathan.com)).
