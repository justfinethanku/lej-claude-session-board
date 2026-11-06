const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const template = fs.readFileSync(path.join(root, 'assets/board-template.html'), 'utf8');
const block = /(<script\b[^>]*\bid="board-data"[^>]*>)[\s\S]*?(<\/script\s*>)/i;
function board(projectFolder, boardId) {
  return { projectFolder, boardId, updated: 'test', manager: 'Manager',
    sessions: [{ id: 'work', name: 'Work', state: 'Ready', questions: [{
      id: 'decision', title: 'Proceed?', to: 'Work',
      options: [{ label: 'Yes', text: 'Proceed with this project.', rec: true }]
    }], pastes: [{ id: 'handoff', title: 'Handoff', to: 'Worker', text: 'Original handoff' }] }],
    groups: [{ title: 'Builds', items: [{ text: 'Build', starter: {
      title: 'PRJ1 Build', prompt: 'Original starter'
    } }] }] };
}
function storage() {
  const values = new Map();
  return { getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)) };
}
function open(t, data, shared, url = 'https://board.example.test/board.html', html) {
  const errors = [], timers = [], scrolls = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => errors.push(e.message));
  let now = Date.now();
  const dom = new JSDOM(html || template.replace(block, (_, start, end) =>
    start + JSON.stringify(data).replace(/</g, '\\u003c') + end), {
    url, runScripts: 'dangerously', virtualConsole,
    beforeParse(window) {
      Object.defineProperty(window, 'localStorage', { value: shared.local });
      Object.defineProperty(window, 'sessionStorage', { value: shared.session });
      Object.defineProperty(window.navigator, 'clipboard', {
        value: { writeText: async () => {} }
      });
      window.setInterval = fn => { timers.push(fn); return timers.length; };
      window.scrollTo = (x, y) => scrolls.push(y);
      window.Date.now = () => now;
    }
  });
  t.after(() => dom.window.close());
  return { window: dom.window, document: dom.window.document, errors, timers, scrolls,
    advance: () => { now += 61000; } };
}
function edit(page, selector, value) {
  const field = page.document.querySelector(selector);
  field.value = value;
  field.dispatchEvent(new page.window.Event('input'));
}
async function modify(page) {
  const own = page.document.querySelectorAll('.opts input')[1];
  own.checked = true;
  own.dispatchEvent(new page.window.Event('change'));
  edit(page, '#reply-decision', 'My private reply');
  edit(page, '#paste-handoff', 'My handoff');
  edit(page, '.starter textarea', 'My starter');
  const section = page.document.querySelector('.session');
  section.open = true;
  section.dispatchEvent(new page.window.Event('toggle'));
  const group = page.document.querySelector('.group');
  group.open = true;
  group.dispatchEvent(new page.window.Event('toggle'));
  for (const button of page.document.querySelectorAll('.copy')) button.click();
  await Promise.resolve();
}
function fresh(page) {
  assert.equal(page.document.querySelector('#reply-decision').value, 'Proceed with this project.');
  assert.equal(page.document.querySelector('.opts input').checked, true);
  assert.equal(page.document.querySelector('#paste-handoff').value, 'Original handoff');
  assert.equal(page.document.querySelector('.starter textarea').value, 'Original starter');
  assert.equal(page.document.querySelector('.session').open, false);
  assert.equal(page.document.querySelector('.group').open, false);
  assert.equal(page.document.querySelectorAll('.copy.was').length, 0);
  assert.deepEqual(page.errors, []);
}

test('project state is isolated while replies, picks, pastes, starters and marks survive rebuilds', async t => {
  const shared = { local: storage(), session: storage() };
  const first = open(t, board('/projects/alpha'), shared);
  await modify(first);
  const second = open(t, board('/projects/beta'), shared);
  fresh(second);
  const rebuilt = open(t, board('/projects/alpha'), shared);
  assert.equal(rebuilt.document.querySelector('#reply-decision').value, 'My private reply');
  assert.equal(rebuilt.document.querySelectorAll('.opts input')[1].checked, true);
  assert.equal(rebuilt.document.querySelector('#paste-handoff').value, 'My handoff');
  assert.equal(rebuilt.document.querySelector('.starter textarea').value, 'My starter');
  assert.equal(rebuilt.document.querySelector('.session').open, true);
  assert.equal(rebuilt.document.querySelector('.group').open, true);
  assert.equal(rebuilt.document.querySelectorAll('.copy.was').length, 3);
  assert.deepEqual(rebuilt.errors, []);
});

test('explicit board ids separate boards in one project and survive a project move', async t => {
  const shared = { local: storage(), session: storage() };
  await modify(open(t, board('/projects/alpha', 'operations'), shared));
  fresh(open(t, board('/projects/alpha', 'research'), shared));
  const moved = open(t, board('/projects/renamed', 'operations'), shared);
  assert.equal(moved.document.querySelector('#reply-decision').value, 'My private reply');
});

test('legacy boards without identity use their page path and ignore ambiguous old keys', async t => {
  const shared = { local: storage(), session: storage() };
  shared.local.setItem('text:decision', 'Unscoped old answer');
  const first = open(t, board(), shared, 'https://board.example.test/alpha.html');
  fresh(first);
  await modify(first);
  fresh(open(t, board(), shared, 'https://board.example.test/beta.html'));
  assert.equal(open(t, board(), shared, 'https://board.example.test/alpha.html')
    .document.querySelector('#reply-decision').value, 'My private reply');
});

test('standalone auto-reload keeps scroll per page, including legacy trusted fragments', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-state-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'fragment.html'), output = path.join(dir, 'board.html');
  fs.writeFileSync(input, '<h1>Legacy board</h1>');
  const built = spawnSync('python3', ['scripts/build_local.py', input, output], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const html = fs.readFileSync(output, 'utf8');
  const shared = { local: storage(), session: storage() };
  const first = open(t, null, shared, 'https://board.example.test/alpha.html', html);
  Object.defineProperty(first.window, 'scrollY', { value: 320 });
  first.advance();
  first.timers[0]();
  const other = open(t, null, shared, 'https://board.example.test/beta.html', html);
  other.window.dispatchEvent(new other.window.Event('load'));
  assert.deepEqual(other.scrolls, []);
  const rebuilt = open(t, null, shared, 'https://board.example.test/alpha.html', html);
  rebuilt.window.dispatchEvent(new rebuilt.window.Event('load'));
  assert.deepEqual(rebuilt.scrolls, [320]);
});
