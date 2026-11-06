const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const template = fs.readFileSync(path.join(root, 'assets/board-template.html'), 'utf8');
function open(t, fallback) {
  const data = JSON.parse(template.match(/id="board-data">([\s\S]*?)<\/script>/)[1]);
  const s = data.sessions[0];
  s.questions.push({ ...s.questions[0], id: 'another', title: 'Another decision' });
  s.actions = [{ id: 'setup', title: 'Set up account', text: 'Paste this', link: 'https://example.com' }];
  s.pastes = [{ id: 'handoff', title: 'Handoff', text: 'Work', to: 'Worker' }];
  const dom = new JSDOM(template.replace(/(id="board-data">)[\s\S]*?(<\/script>)/,
    (_, a, b) => a + JSON.stringify(data).replace(/</g, '\\u003c') + b), {
    url: 'https://board.test/', runScripts: 'dangerously', beforeParse(w) {
      if (fallback === undefined) Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: () => Promise.resolve() } });
      w.document.execCommand = () => { w.document.querySelector('textarea[readonly]').focus(); return fallback; };
    }
  });
  t.after(() => dom.window.close());
  dom.window.document.querySelectorAll('details').forEach(d => { d.open = true; });
  return dom.window;
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('question groups and notes are associated, and each copy control names its purpose', t => {
  const w = open(t), d = w.document;
  assert.equal(d.querySelectorAll('main').length, 1);
  for (const fieldset of d.querySelectorAll('fieldset')) {
    const title = d.getElementById(fieldset.getAttribute('aria-labelledby'));
    assert.ok(title && /^H[1-6]$/.test(title.tagName), 'choices have a question heading as their name');
    const field = fieldset.parentElement.querySelector('textarea');
    const note = fieldset.parentElement.querySelector('.q-note');
    if (note) {
      assert.equal(d.getElementById(fieldset.getAttribute('aria-describedby')), note);
      assert.equal(d.getElementById(field.getAttribute('aria-describedby')), note);
    }
  }
  const names = [...d.querySelectorAll('button.copy')].map(b => b.getAttribute('aria-label'));
  assert.ok(names.every(n => n && n.startsWith('Copy ') && n.length > 12));
  assert.equal(new Set(names).size, names.length, 'action text, done, replies, batch, paste and starter are distinguishable');
  assert.ok(d.querySelector('a[href="https://example.com/"]'));
});

test('selecting the custom radio keeps focus in the native choice group', t => {
  const w = open(t), d = w.document;
  const radio = d.querySelector('.opts').lastElementChild.querySelector('input');
  radio.focus(); radio.checked = true; radio.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(d.activeElement, radio, 'arrow-key navigation can continue to other choices');
});

test('clipboard success and failure announce context and fallback restores the invoking control', async t => {
  for (const fallback of [undefined, true, false]) {
    const w = open(t, fallback), d = w.document;
    const b = d.querySelector('.q .copy'); b.focus(); b.click(); await settle();
    assert.equal(d.activeElement, b);
    const status = d.querySelector('[role="status"]');
    assert.ok(status, 'copy result has a live status region');
    assert.match(status.textContent, /checkout speed/i);
    assert.match(status.textContent, fallback === false ? /select.*copy/i : /copied to clipboard/i);
    assert.equal(d.querySelector('textarea[readonly]'), null);
    assert.ok(b.getAttribute('aria-label').includes(b.textContent.replace('✓ ', '')), 'accessible name contains the current visible label');
  }
});

function luminance(hex) {
  const rgb = hex.match(/[a-f\d]{2}/gi).map(s => parseInt(s, 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
test('text, text field boundaries and focus colors meet contrast thresholds in each theme', () => {
  const themes = [...template.matchAll(/:root[^{}]*\{([^}]+)\}/g)].map(m => Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*(#[a-f\d]{6})/gi)].map(v => [v[1], v[2]])));
  for (const c of themes) {
    for (const bg of ['bg', 'surface', 'field']) {
      for (const fg of ['fg', 'muted', 'accent', 'ok']) assert.ok(contrast(c[fg], c[bg]) >= 4.5, `${fg} on ${bg}: ${contrast(c[fg], c[bg])}`);
      assert.ok(contrast(c['field-border'] || c.rule, c[bg]) >= 3, `field boundary on ${bg}: ${contrast(c['field-border'] || c.rule, c[bg])}`);
      assert.ok(contrast(c.accent, c[bg]) >= 3, 'focus indicator');
    }
    assert.ok(contrast(c['accent-fg'], c.accent) >= 4.5, 'primary button label');
  }
  assert.match(template, /textarea\s*\{[^}]*border:\s*1px solid var\(--field-border\)/);
  assert.match(template, /a:focus-visible/);
});

const result = spawnSync('python3', ['-c', 'import runpy,json; print(json.dumps(runpy.run_path("scripts/build_local.py")["RELOAD"]))'], { cwd: root, encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
const reload = JSON.parse(result.stdout).replace(/^<script[^>]*>|<\/script>$/g, '').replace('location.reload();', 'window.reloads += 1;');
function refreshPage(t, storage = new Map()) {
  const dom = new JSDOM('<header></header><main><button id="copy">Copy</button><details><summary>Session</summary></details><a href="#">Link</a><textarea></textarea></main>', { url: 'https://board.test/index.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window; w.clock = 0; w.reloads = 0; w.Date.now = () => w.clock;
  w.setInterval = cb => { w.tick = cb; };
  Object.defineProperty(w, 'sessionStorage', { value: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) } });
  w.eval(reload); return w;
}
test('automatic refresh can be paused across reloads, resumed, and does not interrupt focused controls', t => {
  const storage = new Map(), w = refreshPage(t, storage), d = w.document;
  const pause = d.querySelector('#pause-refresh');
  assert.ok(pause, 'a keyboard-operable pause button is present before the first timer');
  assert.equal(pause.getAttribute('aria-pressed'), 'false');
  pause.click(); pause.blur(); w.clock = 60000; w.tick(); assert.equal(w.reloads, 0);
  assert.equal(pause.getAttribute('aria-pressed'), 'true');
  const resumed = refreshPage(t, storage);
  assert.equal(resumed.document.querySelector('#pause-refresh').getAttribute('aria-pressed'), 'true');
  resumed.clock = 60000; resumed.tick(); assert.equal(resumed.reloads, 0);
  resumed.document.querySelector('#pause-refresh').click();
  resumed.clock = 120000; resumed.tick(); assert.equal(resumed.reloads, 1);
  for (const control of resumed.document.querySelectorAll('button, summary, a, textarea')) {
    control.focus(); resumed.clock += 60000; resumed.tick(); assert.equal(resumed.reloads, 1, control.outerHTML);
    control.blur();
  }
  resumed.clock += 60000; resumed.tick(); assert.equal(resumed.reloads, 2);
});
