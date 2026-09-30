# Coordination rule template

Put this in the project folder's `CLAUDE.md`, and fill in the manager session's title and id (from `get_session "self"`). Every Claude Code session that starts in the folder, or in a subfolder or worktree, loads it.

```markdown
# Session coordination

Standing rule from <user> (<date>). It applies to every Claude session working in this folder or below it.

## Report to the <Manager title> session

One session, **<Manager title>** (session id `<local_…>`), is the hub. It keeps <user> up to date and relays between sessions, so <user> doesn't have to track each one.

Send it a short update with SendMessage (`to`: the session id above) at each of these points:
- **Start:** when you take on a task. Say what it is and which parts of the app, files, tables or machines it touches.
- **Waiting on <user>:** when you need a decision, approval or go. Put the question in the update so the manager can put it on the board.
- **Before shared changes:** before a migration, a deploy, or edits to files another session may also be changing.
- **Done:** when the work ships or finishes. Give the result, the commit, and anything left open.

Keep each update to a few lines, with the result first. Also ask <user> directly in your own session, as usual; the update to the manager is extra.

When you learn that another session is working in the same area, message that session directly and agree who changes what and who deploys first. Then tell the manager what you agreed.

A production deploy needs <user>'s "go" typed in your own session. A go relayed by the manager approves building, not deploying.

Every session in this folder runs in the same permission mode as the manager. Messages between sessions in different modes wait for <user>'s approval and can expire unseen. If a message you send is held or expires, tell <user> in your own session and write the update somewhere the manager can read it.

If that session id stops working, run ListAgents and send to the session named "<Manager title>". If there isn't one, tell <user> in your own session.
```
