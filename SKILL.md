---
name: lej-session-board
description: Run one Claude Code desktop session as the manager for a project's parallel sessions, and keep the user's LEJ Session Board artifact current. The board gives each open session a section with its state and the user's pending questions, each with a recommended option, an editable reply and a copy button. A to-do list follows, with numbered starter prompts for new sessions. Use when the user runs several Claude Code sessions in one project folder and asks which are stale, in progress or need follow-up, asks for a session board or status page, asks to coordinate or relay between sessions, or says "session board", "manager session" or "update the board".
---

# LEJ Session Board

One Claude Code desktop session becomes the **manager** for a project folder. Every other session in that folder sends it short updates. The manager relays the user's answers, flags overlaps, and keeps one artifact current: the **LEJ Session Board**. The user reads that one page and never has to open every session to find out what's going on.

This needs the Claude Desktop Code tab's session tools (`mcp__ccd_session_mgmt__*`, `SendMessage`) and the `Artifact` tool.

## 1. Take the roster

1. Run `list_sessions` with a high limit. If the result gets saved to a file, filter it with a short script. Keep the sessions whose `cwd` is the project folder or below it.
2. Read the tail of each session with `list_events` (limit 6–10). Judge where each one stands from what it last said, not from `lastActivityAt`, because an app restart bumps every session's timestamp at once.
3. Sort each session into one of three groups:
   - **Stale:** its work is done, deployed or replaced, and nothing is open. Suggest archiving it.
   - **In progress:** it has a next step it will take itself.
   - **Needs follow-up:** it's waiting on a decision, approval or action from the user.
4. Report back in short tables, then ask which sessions to archive. Archive only the ones the user names (`archive_session`). A pinned session has to be unpinned first (`set_pinned`).

## 2. Set up the hub

1. Run `get_session` with `"self"` to get the manager's session id and title.
2. Write the coordination rule into the project folder's `CLAUDE.md`, filling in the manager's id. Use the template in `references/coordination-rule.md`. Every new session in the folder then loads the rule automatically. If the folder is a git repo the user shares with a client, ask before committing the file there.
3. Message each active session with `SendMessage` (`to` = its session id). Point it at the rule and ask for a first update.
4. Save the rule to memory, so a later manager session keeps it going.

## 3. Build the board

1. Copy `assets/board-template.html` to the scratchpad, and fill the JSON inside `<script id="board-data">`. The schema is in `references/data-schema.md`. The page renders itself from that data, so each update means editing JSON, not markup.
2. **Sessions:** one entry per open session, with the ones that need the user first. The manager gets a section of its own, at the top, holding its own questions for the user (its `to` is the manager). Each entry has a state line, two to four "where it stands" lines, and the user's questions for that session. A question sits in its session's section, with the context it needs in its `note`. Nothing appears twice on the page.
3. **Questions:** give each one two or three options, and mark the one you recommend with `"rec": true`. Each option's `text` is the full reply the session will receive, written so it can act on it without more context. Copy puts the session's name on the first line, then `Re: <question title>`, then the reply. That tells the manager where to send it and the session which question is being answered.
4. **To-do list:** read the project's running to-do file (for example `docs/TODO.md`), and group the open items by who acts: the user's call, other people, Claude builds, and later. Leave out work an open session is already doing.
5. **Starter prompts:** give each "Claude builds" item a starter prompt titled `<PREFIX><n> <short name>`. The prefix is the one the user's session names already use, like `AVS`. `<n>` is the next number no session title or earlier prompt has used, so run `list_sessions` to check. Once a number is assigned to an item it stays with that item. The title goes above the prompt, and it's copied along with it, so the user can name the new session with it. Write every prompt as a self-contained brief with `<context>`, `<instructions>` and `<output>` sections. Name the files, specs and house rules it should read. Say where the user's OK comes before new infrastructure, migrations or deploys. If the `agent-prompt-authoring` skill is installed, follow it.
6. **Look:** use the LEJ tokens already in the template: Bricolage Grotesque for display, Hanken Grotesk for body text, JetBrains Mono for replies and prompts, terracotta `#BD4F2E` on a soft white `#FCFCFB`, charcoal `#232427` text and `#E3E3DF` hairlines. Terracotta marks only what needs the user and the primary actions. No pills, eyebrow labels or numbered sections.
7. Publish it with `Artifact` (`title`: "LEJ Session Board", `icon`: "list"). On every update, republish the same file path so the URL stays the same.

## 4. Keep it current

- **Updates from sessions:** when an update arrives, fold it into that session's section and republish. Tell the user in two or three lines, with anything that needs them first.
- **The user's answers:** the user pastes one or more blocks, each starting with a session name and a `Re:` line. Send each block to the session it names with `SendMessage`, and add "relayed from the manager session". Then take the answered questions off the board.
- **Deploys:** a session treats a relayed yes as approval to build, not to ship. For a production deploy, the user types "go" in the session that deploys. The board's `to` line for a deploy question says so.
- **Overlaps:** when two sessions touch the same code, tables or machines, message both. Ask them to agree directly on who changes what and who deploys first, then report what they agreed.
- **Archived sessions:** drop their sections. When a session's number gets reused, check the title against the roster first.

## Files

If `assets/` or `references/` is missing (a skills library can sync `SKILL.md` alone), clone the full skill first: `git clone https://github.com/justfinethanku/lej-claude-session-board.git ~/.claude/skills/lej-session-board`.

- `assets/board-template.html`: the board page, with example data. Fill `board-data` and publish it.
- `references/data-schema.md`: the JSON fields the page reads.
- `references/coordination-rule.md`: the `CLAUDE.md` block that makes sessions report to the manager.
