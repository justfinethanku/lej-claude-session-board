#!/usr/bin/env python3
"""Turn the board fragment into a standalone page you open from disk.

    python3 scripts/build_local.py <board.html> <out.html> [--data board.json]

<board.html> is the filled template (the same fragment the Artifact tool publishes). The output adds the
doctype, charset and viewport, plus a script that reloads the page every 60 seconds so the open tab picks up
each rewrite. A header button pauses automatic refresh for this tab/page. It will not reload while a control
has focus, a draft save has failed, or within 20 seconds of interaction, and it keeps your scroll position. Edited replies and "Copied" marks survive, since the page keeps them
in localStorage.
"""
import argparse
import json
import os
from pathlib import Path
import re
import stat
import tempfile

RELOAD = """<script id="local-autoreload">
(function () {
  var last = Date.now();
  var pauseKey = 'lej-board:pause-refresh:' + location.pathname, paused = false;
  try { paused = sessionStorage.getItem(pauseKey) === '1'; } catch (e) {}
  var pause = document.createElement('button');
  pause.id = 'pause-refresh'; pause.type = 'button'; pause.className = 'refresh-control';
  pause.textContent = 'Pause automatic refresh';
  function showPause() {
    pause.setAttribute('aria-pressed', String(paused));
    pause.textContent = (paused ? '✓ ' : '') + 'Pause automatic refresh';
  }
  showPause();
  pause.addEventListener('click', function () {
    paused = !paused; last = Date.now(); showPause();
    try { sessionStorage.setItem(pauseKey, paused ? '1' : '0'); } catch (e) {}
  });
  (document.querySelector('header') || document.body).appendChild(pause);
  ['keydown', 'input', 'mousedown', 'pointerdown', 'focusin', 'scroll'].forEach(function (e) {
    document.addEventListener(e, function () { last = Date.now(); }, true);
  });
  var scrollKey = 'lej-board:scroll:' + location.pathname;
  var y = 0;
  try { y = +sessionStorage.getItem(scrollKey) || 0; } catch (e) {}
  if (y) window.addEventListener('load', function () { window.scrollTo(0, y); });
  setInterval(function () {
    var a = document.activeElement;
    var interacting = a && (a.matches('textarea, input, button, summary, a[href], select, [tabindex]') || a.isContentEditable);
    if (paused || interacting || document.querySelector('[data-unsaved-draft]') || Date.now() - last < 20000) return;
    try { sessionStorage.setItem(scrollKey, String(window.scrollY)); } catch (e) {}
    location.reload();
  }, 60000);
})();
</script>"""


def validate_data(data):
    """Check renderer inputs before replacing a usable page; keep values private."""
    question_ids = set()

    def obj(value, path):
        if not isinstance(value, dict):
            raise ValueError(f"{path}: expected an object")

    def strings(value, path, required=(), optional=()):
        obj(value, path)
        for key in required:
            if not isinstance(value.get(key), str) or not value[key].strip():
                raise ValueError(f"{path}.{key}: expected a nonempty string")
        for key in optional:
            if value.get(key) is not None and not isinstance(value[key], str):
                raise ValueError(f"{path}.{key}: expected a string")

    def items(value, key, path, required=False):
        found = value.get(key)
        if found is None and not required:
            return []
        if not isinstance(found, list):
            raise ValueError(f"{path}.{key}: expected an array")
        return [(item, f"{path}.{key}[{i}]") for i, item in enumerate(found)]

    def question(value, path):
        strings(value, path, ("id", "title", "to"), ("note",))
        if value["id"] in question_ids:
            raise ValueError(f"{path}.id: duplicate question id")
        question_ids.add(value["id"])
        for option, opath in items(value, "options", path, required=True):
            # Empty reply text is useful; do not enforce a fixed option count.
            strings(option, opath, ("label",), ("text",))
            if not isinstance(option.get("text"), str):
                raise ValueError(f"{opath}.text: expected a string")

    strings(data, "$", ("manager",), ("boardId", "projectFolder", "updated", "updatedISO", "overview", "todoIntro", "reportBack"))
    for session, path in items(data, "sessions", "$", required=True):
        strings(session, path, ("id", "name"), ("state", "need", "tone"))
        for key in ("where", "backlog"):
            for line, lpath in items(session, key, path):
                if not isinstance(line, str):
                    raise ValueError(f"{lpath}: expected a string")
        for value, qpath in items(session, "questions", path):
            question(value, qpath)
        for action, apath in items(session, "actions", path):
            strings(action, apath, ("id", "title"), ("why", "link", "linkText", "text", "textTo"))
            for step, spath in items(action, "steps", apath):
                if not isinstance(step, str):
                    raise ValueError(f"{spath}: expected a string")
        for paste, ppath in items(session, "pastes", path):
            strings(paste, ppath, ("id", "title", "to"), ("note", "text"))
            if not isinstance(paste.get("text"), str):
                raise ValueError(f"{ppath}.text: expected a string")
        for reminder, rpath in items(session, "reminders", path):
            strings(reminder, rpath, (), ("text", "when"))
    for group, path in items(data, "groups", "$", required=True):
        strings(group, path, ("title",))
        for item, ipath in items(group, "items", path, required=True):
            strings(item, ipath, (), ("text",))
            if item.get("question") is not None:
                question(item["question"], ipath + ".question")
            if item.get("starter") is not None:
                strings(item["starter"], ipath + ".starter", ("title",), ("prompt",))
                if not isinstance(item["starter"].get("prompt"), str):
                    raise ValueError(f"{ipath}.starter.prompt: expected a string")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("src", help="Trusted board HTML template")
    parser.add_argument("dst", help="Standalone HTML output")
    parser.add_argument("--data", type=Path, help="Board JSON to embed safely in the template")
    args = parser.parse_args()
    body = Path(args.src).read_text(encoding="utf-8")
    if args.data:
        data = json.loads(args.data.read_text(encoding="utf-8"))
        try:
            validate_data(data)
        except ValueError as error:
            parser.error(f"Invalid board data at {error}")
        # JSON quoting alone does not stop the HTML parser recognizing </script>.
        encoded = json.dumps(data, ensure_ascii=True).replace("<", "\\u003c")
        block = re.compile(r'(<script\b[^>]*\bid="board-data"[^>]*>)[\s\S]*?(</script\s*>)', re.I)
        if len(block.findall(body)) != 1:
            parser.error("Template must contain exactly one script with id=\"board-data\"")
        body = block.sub(lambda m: m[1] + "\n" + encoded + "\n" + m[2], body)
    page = (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n<body>\n'
        + body + "\n" + RELOAD + "\n</body>\n</html>\n"
    )
    dst = Path(args.dst)
    # Build beside the destination so replacement is atomic on the same
    # filesystem. A partial write must not truncate the last usable board.
    with tempfile.TemporaryDirectory(dir=dst.parent, prefix="." + dst.name + ".") as staging:
        pending = Path(staging) / "board.html"
        pending.write_text(page, encoding="utf-8")
        if dst.exists():
            pending.chmod(stat.S_IMODE(dst.stat().st_mode))
        os.replace(pending, dst)
    print("wrote", args.dst)


if __name__ == "__main__":
    main()
