const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const template = fs.readFileSync(path.join(__dirname, '../assets/board-template.html'), 'utf8');
function question(id) {
  return { id, title: 'Decide ' + id, to: 'Worker', options: [
    { label: 'Wait', text: 'Wait for more data.' },
    { label: 'Proceed', text: 'Proceed carefully.', rec: true }
  ] };
}
function board() {
  return { boardId: 'interactions', updated: 'test', manager: 'Manager',
    reportBack: 'Report the result to Manager.', projectFolder: '/project',
    sessions: [{ id: 'worker', name: 'Worker', state: 'Waiting',
      questions: [question('one'), question('two')],
      pastes: [{ id: 'handoff', title: 'Handoff', to: 'Other machine', text: 'Original handoff' }],
      actions: [{ id: 'setup', title: 'Configure account', text: 'Setup text', steps: ['Open settings'] }]
    }, { id: 'manager', name: 'Manager', isManager: true, state: 'Waiting', questions: [question('three')] }],
    groups: [{ title: 'Your call', items: [{ text: 'A decision', question: question('four') },
      { text: 'Start work', starter: { title: 'PRJ5 Build', prompt: 'Build the feature' } }] }] };
}
function open(t, { clipboard, fallback = true, stored = new Map() } = {}) {
  const writes = [], fallbacks = [], errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(template.replace(/(<script\b[^>]*id="board-data"[^>]*>)[\s\S]*?(<\/script>)/i,
    (_, start, end) => start + JSON.stringify(board()).replace(/</g, '\\u003c') + end), {
    url: 'https://board.example.test/', runScripts: 'dangerously', virtualConsole: vc,
    beforeParse(window) {
      Object.defineProperty(window, 'localStorage', { value: {
        getItem: k => stored.has(k) ? stored.get(k) : null,
        setItem: (k, v) => stored.set(k, String(v))
      } });
      Object.defineProperty(window.navigator, 'clipboard', { value: clipboard === null ? undefined : {
        writeText: text => { writes.push(text); return clipboard ? clipboard(text) : Promise.resolve(); }
      } });
      window.document.execCommand = command => {
        assert.equal(command, 'copy');
        fallbacks.push(window.document.querySelector('textarea[readonly]').value);
        return fallback;
      };
    }
  });
  t.after(() => dom.window.close());
  return { document: dom.window.document, window: dom.window, writes, fallbacks, errors, stored };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
function edit(p, selector, text) {
  const field = p.document.querySelector(selector);
  field.value = text;
  field.dispatchEvent(new p.window.Event('input', { bubbles: true }));
}
function pick(p, index) {
  const input = p.document.querySelector('#s-worker .opts').querySelectorAll('input')[index];
  input.checked = true;
  input.dispatchEvent(new p.window.Event('change', { bubbles: true }));
}
function replyButton(p, id = 'one') { return p.document.getElementById('reply-' + id).closest('.q').querySelector('.copy'); }
function batch(p) { return p.document.querySelector('#s-worker .copy-all .copy'); }

test('recommended option, editable answers and custom draft round trips use the visible reply', async t => {
  const p = open(t);
  assert.equal(p.document.querySelector('#reply-one').value, 'Proceed carefully.');
  pick(p, 2);
  edit(p, '#reply-one', '  My own answer  ');
  pick(p, 0);
  assert.equal(p.document.querySelector('#reply-one').value, 'Wait for more data.');
  pick(p, 2);
  assert.equal(p.document.querySelector('#reply-one').value, '  My own answer  ');
  replyButton(p).click(); await settle();
  assert.deepEqual(p.writes, ['Worker\nRe: Decide one\nMy own answer\n\nReport the result to Manager.']);
  assert.deepEqual(p.errors, []);
});

test('batch copy uses current replies, one session header and one report-back; manager replies omit it', async t => {
  const p = open(t);
  edit(p, '#reply-one', 'First edited reply'); edit(p, '#reply-two', 'Second edited reply');
  batch(p).click(); await settle();
  assert.equal(p.writes[0], 'Worker\n\nRe: Decide one\nFirst edited reply\n\nRe: Decide two\nSecond edited reply\n\nReport the result to Manager.');
  assert.ok(replyButton(p).classList.contains('was'));
  assert.ok(replyButton(p, 'two').classList.contains('was'));
  replyButton(p, 'three').click(); replyButton(p, 'four').click(); await settle();
  assert.deepEqual(p.writes.slice(1), ['Manager\nRe: Decide three\nProceed carefully.', 'Manager\nRe: Decide four\nProceed carefully.']);
  assert.deepEqual(p.errors, []);
});

test('editing or choosing another option invalidates individual and batch copy receipts, including after reload', async t => {
  const p = open(t);
  batch(p).click(); await settle();
  edit(p, '#reply-one', 'This answer has not been copied');
  assert.equal(replyButton(p).classList.contains('was'), false);
  assert.equal(batch(p).classList.contains('was'), false);
  assert.equal(replyButton(p, 'two').classList.contains('was'), true);
  const rebuilt = open(t, { stored: p.stored });
  assert.equal(replyButton(rebuilt).classList.contains('was'), false);
  assert.equal(batch(rebuilt).classList.contains('was'), false);
  batch(p).click(); await settle(); pick(p, 0);
  assert.equal(replyButton(p).classList.contains('was'), false);
  assert.equal(batch(p).classList.contains('was'), false);
});

test('a delayed clipboard result cannot mark an edited answer or batch as copied', async t => {
  for (const all of [false, true]) {
    let finish;
    const p = open(t, { clipboard: () => new Promise(resolve => { finish = resolve; }) });
    (all ? batch(p) : replyButton(p)).click();
    edit(p, '#reply-one', 'Changed while copying'); finish(); await settle();
    assert.equal(replyButton(p).classList.contains('was'), false);
    assert.equal(batch(p).classList.contains('was'), false);
    assert.equal(replyButton(p, 'two').classList.contains('was'), false);
  }
});

test('clipboard rejection and unavailable API use fallback; failed fallback never issues a receipt', async t => {
  for (const clipboard of [() => Promise.reject(new Error('Denied')), null, () => { throw new Error('Denied'); }]) {
    const p = open(t, { clipboard });
    replyButton(p).click(); await settle();
    assert.equal(p.fallbacks.length, 1);
    assert.equal(p.fallbacks[0], 'Worker\nRe: Decide one\nProceed carefully.\n\nReport the result to Manager.');
    assert.equal(replyButton(p).classList.contains('was'), true);
    assert.equal(p.document.querySelectorAll('textarea[readonly]').length, 0);
    assert.deepEqual(p.errors, []);
  }
  const p = open(t, { clipboard: null, fallback: false });
  batch(p).click(); await settle();
  assert.equal(p.document.querySelectorAll('.copy.was').length, 0);
  assert.equal(batch(p).textContent, 'Select the text and copy');
  assert.equal(p.document.querySelectorAll('textarea[readonly]').length, 0);
});

test('edited handoffs and starter prompts lose old receipts; action copies keep their destination', async t => {
  const p = open(t);
  const paste = p.document.querySelector('#paste-handoff').closest('.q').querySelector('.copy');
  const starter = p.document.querySelector('.starter .copy');
  const doneMark = p.document.querySelector('.done-mark');
  paste.click(); starter.click();
  const actionButtons = p.document.querySelectorAll('.action .copy');
  actionButtons[0].click(); actionButtons[1].click(); await settle();
  assert.deepEqual(p.writes, ['Original handoff', 'PRJ5 Build\n\nBuild the feature', 'Setup text', 'Manager\nDone: Configure account']);
  assert.equal(doneMark.textContent, '✓ copied');
  edit(p, '#paste-handoff', 'New handoff'); edit(p, '.starter textarea', 'New prompt');
  assert.equal(paste.classList.contains('was'), false);
  assert.equal(starter.classList.contains('was'), false);
  assert.equal(doneMark.textContent, '');
  paste.click(); starter.click(); await settle();
  assert.deepEqual(p.writes.slice(-2), ['New handoff', 'PRJ5 Build\n\nNew prompt']);
});

test('editing handoffs and starters also rejects delayed copy receipts and does not start a stale fallback', async t => {
  for (const selector of ['#paste-handoff', '.starter textarea']) {
    for (const rejected of [false, true]) {
      let complete;
      const p = open(t, { clipboard: () => new Promise((resolve, reject) => {
        complete = rejected ? () => reject(new Error('Denied')) : resolve;
      }) });
      const field = p.document.querySelector(selector);
      const button = field.parentElement.querySelector('.copy');
      button.click();
      edit(p, selector, 'Changed while copying');
      complete(); await settle();
      assert.equal(button.classList.contains('was'), false);
      assert.equal(p.document.querySelector('.done-mark').textContent, '');
      assert.deepEqual(p.fallbacks, []);
      assert.deepEqual(p.errors, []);
    }
  }
});
