const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const template = fs.readFileSync(path.join(__dirname, '../assets/board-template.html'), 'utf8');
function board(boardId = 'receipt-replay') {
  return { boardId, manager: 'Manager', updated: 'test', projectFolder: '/project',
    sessions: [{ id: 'worker', name: 'Worker', state: 'Waiting', questions: ['one', 'two'].map(id => ({
      id, title: 'Decide ' + id, to: 'Worker', options: [{ label: 'Wait', text: 'Wait.', rec: true }]
    })), pastes: [{ id: 'handoff', title: 'Handoff', to: 'Worker', text: 'Original handoff' }],
    actions: [{ id: 'setup', title: 'Set up', text: 'Original action' }] }],
    groups: [{ title: 'Builds', items: [{ text: 'Build', starter: { title: 'PRJ5 Build', prompt: 'Original prompt' } }] }] };
}
function open(t, stored, { data = board(), pending = false } = {}) {
  const errors = [], writes = []; let complete;
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(template.replace(/(<script\b[^>]*id="board-data"[^>]*>)[\s\S]*?(<\/script>)/i,
    (_, start, end) => start + JSON.stringify(data).replace(/</g, '\\u003c') + end), {
    url: 'https://board.example.test/', runScripts: 'dangerously', virtualConsole: vc,
    beforeParse(w) {
      Object.defineProperty(w, 'localStorage', { value: {
        getItem: k => stored.has(k) ? stored.get(k) : null,
        setItem: (k, v) => stored.set(k, String(v))
      } });
      Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: text => {
        writes.push(text); return pending ? new Promise(resolve => { complete = resolve; }) : Promise.resolve();
      } } });
    }
  });
  t.after(() => dom.window.close());
  return { window: dom.window, doc: dom.window.document, writes, errors, complete: () => complete() };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
function edit(p, selector, text) {
  const field = p.doc.querySelector(selector); field.value = text;
  field.dispatchEvent(new p.window.Event('input', { bubbles: true }));
}
const reply = p => p.doc.querySelector('#reply-one').closest('.q').querySelector('.copy');
const batch = p => p.doc.querySelector('.copy-all .copy');

test('old tab completion cannot certify a different persisted reply, handoff, starter or batch', async t => {
  for (const [selector, button] of [
    ['#reply-one', reply], ['#reply-one', batch],
    ['#paste-handoff', p => p.doc.querySelector('#paste-handoff').closest('.q').querySelector('.copy')],
    ['.starter textarea', p => p.doc.querySelector('.starter .copy')]
  ]) {
    const stored = new Map(), old = open(t, stored, { pending: true }), newer = open(t, stored);
    button(old).click();
    edit(newer, selector, 'New text that was never copied');
    old.complete(); await settle();
    const reloaded = open(t, stored);
    assert.equal(reloaded.doc.querySelector(selector).value, 'New text that was never copied');
    assert.equal(button(reloaded).classList.contains('was'), false, selector);
    if (button === batch) assert.equal(reply(reloaded).classList.contains('was'), false);
    if (selector.includes('starter')) assert.equal(reloaded.doc.querySelector('.done-mark').textContent, '');
    assert.ok(old.writes[0].includes(selector.includes('reply') ? 'Wait.' : 'Original'));
    assert.deepEqual(reloaded.errors, []);
  }
});

test('malformed and legacy receipt flags are ignored without losing drafts or stopping rendering', t => {
  const prefix = 'lej-board:["id","receipt-replay"]:';
  for (const receipt of ['1', '0', 'false', 'null', '{broken', '{"version":1,"text":"wrong"}']) {
    const stored = new Map(['q:one', 'paste:handoff', 'starter:PRJ5', 'all:one+two', 'act-text:setup', 'act-done:setup']
      .map(key => [prefix + 'copied:' + key, receipt]));
    stored.set(prefix + 'text:one', 'Keep my draft <script>literal</script>');
    stored.set(prefix + 'pick:one', 'not a number');
    const p = open(t, stored);
    assert.equal(p.doc.querySelectorAll('.copy.was').length, 0, receipt);
    assert.equal(p.doc.querySelector('.done-mark').textContent, '');
    assert.equal(p.doc.querySelector('#reply-one').value, 'Keep my draft <script>literal</script>');
    assert.equal(p.doc.querySelector('.opts input').checked, true);
    assert.deepEqual(p.errors, []);
  }
});

test('matching receipts survive reloads, but changed destinations and board identities do not inherit them', async t => {
  const stored = new Map(), first = open(t, stored);
  for (const button of first.doc.querySelectorAll('.copy')) button.click();
  await settle();
  const same = open(t, stored);
  assert.equal(same.doc.querySelectorAll('.copy.was').length, first.doc.querySelectorAll('.copy').length);
  assert.equal(same.doc.querySelector('.done-mark').textContent, '✓ copied');
  const changed = board(); changed.sessions[0].name = 'Different recipient'; changed.manager = 'New manager';
  changed.groups[0].items[0].starter.title = 'PRJ5 Different task';
  changed.sessions[0].actions[0].text = 'Different action';
  const updated = open(t, stored, { data: changed });
  for (const button of [reply(updated), batch(updated), ...updated.doc.querySelectorAll('.action .copy'), updated.doc.querySelector('.starter .copy')]) {
    assert.equal(button.classList.contains('was'), false, button.getAttribute('aria-label'));
  }
  assert.equal(updated.doc.querySelector('.done-mark').textContent, '');
  assert.equal(open(t, stored, { data: board('different-board') }).doc.querySelectorAll('.copy.was').length, 0);
});
