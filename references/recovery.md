# Recover board drafts and rebuilds

Use this procedure when tabs disagree, a reply disappears after reload, or a rebuild changes the board identity. You need access to the affected browser profile and the project's JSON and generated page. The optional storage snapshot also needs the browser's developer console.

## Know which copy you are recovering

| Copy | What it contains |
|---|---|
| Project JSON | The manager's sessions, questions, options and board identity. Browser edits never update this file. |
| Generated HTML | The template and JSON from the last successful build. It has no browser drafts embedded in it. |
| Browser local storage | Saved picks, replies, custom drafts, edited prompts, open sections and copy receipts for one browser origin and board identity. |
| An open tab | Its working reply and custom draft. Other tabs' edits do not synchronize into these fields. |

The page has no draft import/export button, conflict dialog or automatic merge. A question saves its selection, visible reply and custom draft together; the last successful complete save wins. If storage rejects a draft write, a visible **Not saved** message identifies the field, announces the failure without moving focus, and offers **Retry saving**. The visible edit remains in that tab; automatic refresh waits until every failed draft save recovers. Manual reload and closing the tab can still discard unsaved edits. A **Copied** mark records a successful copy of that exact payload; it does not confirm a saved draft, a session receiving an answer or the current clipboard contents.

## Preserve replies before reloading

1. In every affected tab, press **Pause automatic refresh** until it shows a check mark. Pause stops timed refresh; manual reload and closing the tab still discard its working fields.
2. Save each tab's visible replies and edited prompts in a separate local text file, labelled with the tab, session and question. Select the text in each field and copy it. The board's **Copy** button adds routing text to question replies and trims their edges; it is not a raw draft backup.
3. If a question has a separate custom draft, save the visible reply first, select **Write your own answer**, and save that text too. Selecting an option attempts a new save, so do this only after preserving the visible reply. Retain each tab's version until you have compared them.
4. Optional: take the read-only storage snapshot below before editing further. It contains saved values only; it cannot capture an edit whose save failed or every tab's working copy.

Rebuilding the page or copying its HTML to another machine does not back up browser drafts. Browser profile, scheme, host and port affect storage. Storage for `file:` URLs varies between browsers; a different path or browser is not a reliable migration method. See [the Web Storage specification](https://html.spec.whatwg.org/multipage/webstorage.html) and [localStorage behavior](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).

## Resolve two tabs' answers

1. Preserve all versions using the preceding procedure, then compare their reply and custom-draft text in your editor. Choose or combine the text you want to keep.
2. Close the other tabs after preserving them. In the remaining paused tab, reload to see the last successfully saved answer. There is no conflict warning or revision history to choose from.
3. For each recovered reply, select **Write your own answer** and paste the chosen text into its reply field. Typing or pasting in the field attempts a complete question save. Merely copying an answer does not save it.
4. If **Not saved** appears beside a field, keep your text backup and investigate browser storage availability or quota. The warning remains even after a successful **Copy**. Once storage is available, use that field’s **Retry saving** button to save its current working value without retyping, or edit the field to attempt another save. **Saved** confirms that write succeeded; it is not a conflict check or a durable backup. A successful keyboard retry returns focus to its text field. Recover every affected field before reloading.
5. Keep your text backup, reload the remaining tab, and compare its reply and selected option with your chosen answer. If it reverts, use the backup to restore the text and repeat the save checks.
6. Copy the verified answer when ready to paste it into its session. Resume automatic refresh when recovery is complete.

## Inspect malformed saved state

An invalid question record (bad JSON, unsupported version, invalid option index or non-string text) is ignored on load. The page falls back to older scoped pick/text/custom keys when present, otherwise to its default answer. Loading does not repair or delete the invalid record. Old unscoped keys from before board identities were introduced are not imported.

For a read-only snapshot, open the developer console for the affected board page and run this JavaScript. It reads the identity from that page and returns JSON containing only its scoped local-storage entries:

```javascript
(() => {
  const data = JSON.parse(document.getElementById('board-data').textContent);
  const identity = data.boardId ? ['id', data.boardId]
    : data.projectFolder ? ['project', data.projectFolder]
    : ['page', location.pathname];
  const prefix = 'lej-board:' + JSON.stringify(identity) + ':';
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
  return JSON.stringify({
    identity,
    entries: keys.filter(key => key && key.startsWith(prefix))
      .map(key => [key, localStorage.getItem(key)])
  }, null, 2);
})();
```

Save the returned string's contents as a local JSON file without the console's outer string display quotes. Check that it parses as an object with `identity` and `entries`. Keep it private: replies and copied payloads can contain sensitive text. If the console reports a storage-access error, the snapshot did not succeed. An empty `entries` list means no keys for this page's current identity in that storage area, not that another profile or identity has no drafts. Stop editing in other tabs while taking the snapshot; storage has no cross-tab snapshot lock.

Inspect an entry named `lej-board:…:answer:QUESTION_ID`: its value is itself JSON with `version`, `pick`, `text` and `own`. Recover readable reply or custom text into your local text backup. The fallback keys end in `text:QUESTION_ID` and `own:QUESTION_ID`. These names describe the current storage layout for diagnosis, not a supported write/import API. Preserve a malformed value even when you cannot parse it.

Use the normal reply fields to save recovered text, then reload and compare as in [Resolve two tabs' answers](#resolve-two-tabs-answers). An edit writes a new complete record for that question; it also clears its copy mark. Avoid clearing all site storage: it would discard other boards and any recoverable fallback values along with the damaged record. The snapshot does not include old unscoped keys, session-storage pause/scroll state or drafts under other board identities.

## Recover a rejected rebuild or changed identity

From the project folder, first preserve browser replies and stop competing writers. Before changing the JSON or template, make a backup of the working input and output:

```bash
mkdir .session-board/recovery-before-change
cp -p .session-board/board-data.json .session-board/recovery-before-change/board-data.json
cp -p "LEJ Session Board.html" .session-board/recovery-before-change/board.html
```

Use an unused backup directory name each time. The commands assume the existing JSON and page paths from [Build from your project folder](../README.md#build-from-your-project-folder); substitute your actual paths if they differ. These files preserve the manager's input and page, not browser drafts.

Build the changed input with the installed skill:

```bash
SKILL_DIR="$HOME/.claude/skills/lej-session-board"
python3 "$SKILL_DIR/scripts/build_local.py" "$SKILL_DIR/assets/board-template.html" "LEJ Session Board.html" --data .session-board/board-data.json
```

Use your actual skill directory if installed elsewhere. A successful build prints `wrote LEJ Session Board.html`. A JSON, data-validation, template or write failure leaves the previous output intact. Correct the named input error and repeat the same command. Until a corrected build succeeds, the page still contains the previous data and identity. Concurrent valid builders are last-replacement-wins; run recovery builds one at a time.

If a successful build unexpectedly shows default replies, compare `boardId`, `projectFolder` and the page URL with the backup. Identity uses the first available value: `boardId`, then `projectFolder`, then the URL pathname. An explicit `boardId` takes precedence over a changed project folder. Question IDs must also match. A new board identity does not erase the old identity's saved drafts, but it will not display them.

To return to the saved board data, retain the attempted input, restore the backup JSON and rebuild with the same installed-path command:

```bash
cp -p .session-board/board-data.json .session-board/recovery-before-change/attempted-data.json
cp -p .session-board/recovery-before-change/board-data.json .session-board/board-data.json
python3 "$SKILL_DIR/scripts/build_local.py" "$SKILL_DIR/assets/board-template.html" "LEJ Session Board.html" --data .session-board/board-data.json
```

Reload at the original URL in the same browser profile and verify the embedded identity, question wording and recovered replies. Saved drafts return only if the original storage area is still available and the identity/question IDs match. If the question's meaning changed, give it a new ID and manually transfer only the answer that still applies. Use a new unique identity for a genuinely separate board.

This procedure rolls back data while keeping the current template. Before downgrading the template, copy out current replies: old templates cannot read newer complete question records, and old boolean copy marks are ignored by current templates. See [browser state compatibility](data-schema.md#what-the-viewers-browser-keeps). Copy receipts can reset when a session header, report-back line or payload changes; copy the checked answer again instead of treating an old mark as delivery evidence.
