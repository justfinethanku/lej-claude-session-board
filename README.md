# LEJ Claude Session Board

A Claude Code skill for running a lot of Claude Code sessions in one project without losing track of them.

One session becomes the **manager**. Every other session in the project folder reports to it: when it starts something, when it needs you, before it touches shared code or deploys, and when it's done. The manager keeps one page current, the **LEJ Session Board**. It's a local HTML file in your project folder that reloads itself every minute:

- **An overview up top:** a paragraph on what's happening now and one on what already happened.
- **A collapsed section per open session:** its title and what it needs from you. Urgent sessions come first, then ones with questions, then the rest. Click to open its state, where it stands and its questions.
- **Recommended answers:** each question has two or three options, one marked Recommended, plus **Write your own answer**. Copy puts the session's name and `Re: <question>` above your reply, so the manager knows where it goes. Paste it in the session, or paste a batch back to the manager and it relays each one. **Copy all answers** answers a whole session in one paste.
- **The to-do list:** collapsible groups by who acts. Your-call items come with recommended answers too. Every item Claude can build has a numbered starter prompt (`PRJ5 Short name`) to copy into a new session, title included.
- **Question counts and copy marks:** the header says how many questions need you, and each Copy button turns into "✓ Copied" once used.
- **It stays current on its own:** every answer you copy for a session ends with a line asking it to tell the manager once it's acted. The manager also sweeps every session every 15 minutes, and if nobody has checked in 30 minutes the board says "Out of date" in red.

The manager also keeps the deploy queue (one deploy at a time, best enforced by a lock and queue file in your deploy script so sessions don't wait on manager messages), hands out migration numbers, keeps session titles in the `PRJ5 Short name` pattern, and catches overlaps between sessions.

It uses Claude Desktop's session tools, so it runs in the **Code tab of the Claude desktop app**.

**Local page vs. artifact:** the board is a local file by default (`LEJ Session Board.html` in your project folder). It can also be published as a claude.ai artifact so you can open it on your phone. Artifact publishes have a daily cap per account, which a busy manager hits by mid-afternoon, so the skill publishes only when you ask and never more than every 15–20 minutes.

## Watch it

A three-minute video of the whole loop (install, make a manager, read the board, answer, start new work), plus a step-by-step guided setup: **[limitededitionjonathan.com/session-board](https://limitededitionjonathan.com/session-board)**. The project in the video is made up; its board data is `assets/demo-data.json`.

## Install

You need Git to install the skill and Python 3 to build a local page. Managing sessions also requires the Claude Desktop Code tab and the session tools listed in [the skill instructions](SKILL.md). You can build the demo without those tools. Node.js is needed only for the development checks below.

For a new installation:

```bash
git clone https://github.com/justfinethanku/lej-claude-session-board.git ~/.claude/skills/lej-session-board
```

Check that the full skill is present:

```bash
ls ~/.claude/skills/lej-session-board/{SKILL.md,scripts/build_local.py,assets/board-template.html,references/data-schema.md}
```

Then in a Claude Code desktop session in your project folder, say something like "be the manager for this folder and make me a session board", or "which of my sessions are stale?"

### Update or repair an installation

For a full Git checkout, inspect local changes first. Preserve any edits before updating:

```bash
git -C ~/.claude/skills/lej-session-board status --short
git -C ~/.claude/skills/lej-session-board pull --ff-only
```

If Git refuses the update, resolve the local changes or diverged branch before retrying. If a skills library installed only `SKILL.md`, cloning into that nonempty folder fails. Move the incomplete folder to an unused backup path, then run the install command again. For example, when `lej-session-board.backup` does not already exist:

```bash
mv ~/.claude/skills/lej-session-board ~/.claude/skills/lej-session-board.backup
git clone https://github.com/justfinethanku/lej-claude-session-board.git ~/.claude/skills/lej-session-board
```

Keep project data outside the installed skill. Updating the skill does not update templates copied into projects or pages already generated: rebuild each board with the updated template and its existing JSON. Keep `boardId` (or `projectFolder` when no `boardId` is set) stable so the browser can reuse its saved drafts. See [browser state and older-template compatibility](references/data-schema.md#what-the-viewers-browser-keeps) before updating an older board.

## What's inside

| Path | What it is |
|---|---|
| `SKILL.md` | The instructions Claude follows: roster, hub setup, building the board, keeping it current. |
| `assets/board-template.html` | The board page, rendered from a JSON block. Example data included. |
| `scripts/build_local.py` | Turns the filled template into a standalone page that auto-reloads (60 s, with a pause control). |
| `assets/demo-data.json` | The made-up "Pantry" board from the video, with every feature filled in. |
| `references/data-schema.md` | The JSON fields the page reads. |
| `references/coordination-rule.md` | The `CLAUDE.md` block that makes sessions report to the manager. |
| `references/sweep.md` | The 15-minute sweep the manager schedules to keep the board true. |

## Build a local board

From this repository, keep the template as code and edit the data in a separate JSON file. To build the included demo with Python 3:

```bash
python3 scripts/build_local.py assets/board-template.html "LEJ Session Board.html" --data assets/demo-data.json
```

Open `LEJ Session Board.html`. For your project, replace `assets/demo-data.json` with your board data file. The builder escapes embedded JSON so strings such as `</script>` render as text. Task and backlog prose supports `<b>` and `<code>` without attributes; action links support absolute HTTP(S) URLs. See [the data schema](references/data-schema.md) for details.

### Build from your project folder

The repository-relative command above assumes you are in the skill checkout. From your own project folder, use the installed skill paths instead. For a new board, copy the demo once as a starting point:

```bash
SKILL_DIR="$HOME/.claude/skills/lej-session-board"
mkdir -p .session-board
cp "$SKILL_DIR/assets/demo-data.json" .session-board/board-data.json
```

Use your actual skill directory if you installed elsewhere. For an existing board, keep its JSON instead of copying the demo over it. Edit `.session-board/board-data.json` for your project, including its identity, sessions and questions. Set `updated` and `updatedISO` to the time you actually checked the sessions; the builder preserves those fields and does not refresh them. The demo's historical timestamp intentionally shows an out-of-date board.

Build or rebuild from that same project folder:

```bash
python3 "$SKILL_DIR/scripts/build_local.py" "$SKILL_DIR/assets/board-template.html" "LEJ Session Board.html" --data .session-board/board-data.json
```

The command prints `wrote LEJ Session Board.html`. Open that file in your browser (on macOS, `open "LEJ Session Board.html"`). The generated page displays data; it does not read sessions or send answers itself. The manager updates the JSON and rebuilds; you copy answers into sessions. Browser edits stay in that browser's storage and do not write back to the JSON.

Auto-reload checks every 60 seconds. Use **Pause automatic refresh** in the header when you need more time to read; a check mark means refresh is paused. Press it again to resume. The pause survives manual reloads in the same tab and page when session storage is available. Refresh also waits while a control has focus or an interaction happened in the last 20 seconds. If an update does not appear, resume refresh and click outside the controls, or reload manually after saving your reply. Fonts load from Google Fonts when available, with system-font fallbacks.

The HTML template is trusted executable code. The original two-argument build command still wraps an already-filled template; it does not sanitize that source.

The builder checks `--data` for the renderer's object, array and text fields, including unique question IDs, before writing a temporary page beside the output. It replaces the output only after that write succeeds. A data validation, JSON parse, template or write failure leaves the previous page intact. This also applies when rebuilding the output for a different board identity; browser drafts remain scoped by the identity in the page. A successful rebuild preserves an existing output's file permissions.

### Troubleshoot a local build

| Symptom | Check and recovery |
|---|---|
| `can't open file ... scripts/build_local.py` | You ran a repository-relative command from your project. Use the installed paths above. |
| `FileNotFoundError` | Check the template and JSON paths and create the output's parent directory. The builder does not create directories. |
| `JSONDecodeError` | Run `python3 -m json.tool .session-board/board-data.json` to locate the syntax error, correct it, then rebuild. JSON parse errors happen before the output is written. |
| `Invalid board data at $.…` | Correct the named field using [the data schema](references/data-schema.md), then rebuild. Valid JSON can still have the wrong structure or duplicate question IDs. The existing output stays intact; the diagnostic names the field without printing its value. |
| `Template must contain exactly one script with id="board-data"` | Use the complete `assets/board-template.html` from the installed skill. Pass the JSON with `--data`. |
| The page says `Out of date` immediately | Check `updatedISO` in the JSON. Rebuild with a real check time after the manager checks the sessions. |

## Run the regression tests

Node.js 22.12 or newer is needed only for development tests. From this repository:

```bash
npm ci --ignore-scripts
npm test
```

The tests render the template and built page in jsdom, check HTML and URL injection cases, verify state isolation between boards and persistence across rebuilds, and exercise the demo and original build command. The generated page has no npm runtime dependencies.

## Look

LEJ branding: Bricolage Grotesque, Hanken Grotesk and JetBrains Mono. Terracotta on soft white, with charcoal text and a matching dark mode. Color marks only what needs you and the main actions.

Made by Jonathan Edwards ([Limited Edition Jonathan](https://limitededitionjonathan.com)).

## License

MIT. See [LICENSE](LICENSE).
