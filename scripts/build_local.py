#!/usr/bin/env python3
"""Turn the board fragment into a standalone page you open from disk.

    python3 scripts/build_local.py <board.html> <out.html> [--data board.json]

<board.html> is the filled template (the same fragment the Artifact tool publishes). The output adds the
doctype, charset and viewport, plus a script that reloads the page every 60 seconds so the open tab picks up
each rewrite. It won't reload while you're typing or within 20 seconds of your last click, and it keeps your
scroll position. Edited replies and "Copied" marks survive, since the page keeps them in localStorage.
"""
import argparse
import json
from pathlib import Path
import re

RELOAD = """<script id="local-autoreload">
(function () {
  var last = Date.now();
  ['keydown', 'input', 'mousedown', 'scroll'].forEach(function (e) {
    document.addEventListener(e, function () { last = Date.now(); }, true);
  });
  var scrollKey = 'lej-board:scroll:' + location.pathname;
  var y = 0;
  try { y = +sessionStorage.getItem(scrollKey) || 0; } catch (e) {}
  if (y) window.addEventListener('load', function () { window.scrollTo(0, y); });
  setInterval(function () {
    var a = document.activeElement;
    var typing = a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.isContentEditable);
    if (typing || Date.now() - last < 20000) return;
    try { sessionStorage.setItem(scrollKey, String(window.scrollY)); } catch (e) {}
    location.reload();
  }, 60000);
})();
</script>"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("src", help="Trusted board HTML template")
    parser.add_argument("dst", help="Standalone HTML output")
    parser.add_argument("--data", type=Path, help="Board JSON to embed safely in the template")
    args = parser.parse_args()
    body = Path(args.src).read_text(encoding="utf-8")
    if args.data:
        data = json.loads(args.data.read_text(encoding="utf-8"))
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
    with open(args.dst, "w", encoding="utf-8") as f:
        f.write(page)
    print("wrote", args.dst)


if __name__ == "__main__":
    main()
