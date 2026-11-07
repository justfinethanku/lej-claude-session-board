const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const template = fs.readFileSync(path.join(__dirname, '../assets/board-template.html'), 'utf8');
const prefix = 'lej-board:["id","drafts"]:';
function board(boardId = 'drafts') {
  return { boardId, manager: 'Manager', updated: 'test', sessions: [{
    id: 'work', name: 'Worker', state: 'Waiting', questions: [{
      id: 'decision', title: 'Which plan?', to: 'Worker', options: [
        { label: 'First', text: 'First plan.' }, { label: 'Recommended', text: 'Recommended plan.', rec: true }
      ]
    }]
  }], groups: [] };
}
function storage() {
  const values = new Map();
  return { values, afterWrite: null, maxLength: Infinity,
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem(key, value) {
      value = String(value);
      if (value.length > this.maxLength) throw new Error('QuotaExceededError');
      values.set(key, value);
      if (this.afterWrite) this.afterWrite(key);
    }
  };
}
function open(t, stored, data = board()) {
  const errors = [], copies = [], vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(template.replace(/(<script\b[^>]*id="board-data"[^>]*>)[\s\S]*?(<\/script>)/i,
    (_, start, end) => start + JSON.stringify(data).replace(/</g, '\\u003c') + end), {
    url: 'https://board.example.test/', runScripts: 'dangerously', virtualConsole: vc,
    beforeParse(w) {
      Object.defineProperty(w, 'localStorage', { value: stored });
      Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: text => { copies.push(text); return Promise.resolve(); } } });
    }
  });
  t.after(() => dom.window.close());
  return { window: dom.window, doc: dom.window.document, errors, copies };
}
function choose(p, index) {
  const radio = p.doc.querySelectorAll('.opts input')[index]; radio.checked = true;
  radio.dispatchEvent(new p.window.Event('change', { bubbles: true }));
}
function edit(p, text) {
  const field = p.doc.querySelector('#reply-decision'); field.value = text;
  field.dispatchEvent(new p.window.Event('input', { bubbles: true }));
}
function expectAnswer(p, index, text) {
  assert.deepEqual(p.errors, []);
  assert.equal(p.doc.querySelector('.opts input:checked').id, 'opt-decision-' + index);
  assert.equal(p.doc.querySelector('#reply-decision').value, text);
}

test('each open tab retains its own custom draft through option switches', async t => {
  const stored = storage(), a = open(t, stored), b = open(t, stored);
  choose(a, 2); edit(a, 'Draft from tab A');
  choose(b, 2); edit(b, 'Draft from tab B');
  choose(a, 0); choose(a, 2);
  expectAnswer(a, 2, 'Draft from tab A');
  expectAnswer(b, 2, 'Draft from tab B');
  expectAnswer(open(t, stored), 2, 'Draft from tab A');
  a.doc.querySelector('.copy').click(); await Promise.resolve();
  assert.ok(a.copies[0].includes('Draft from tab A'));
  assert.ok(!a.copies[0].includes('Draft from tab B'));
  expectAnswer(open(t, stored, board('another-board')), 1, 'Recommended plan.');
});

test('a failed option write retains the entire previous saved answer', t => {
  const stored = storage(), data = board(); data.sessions[0].questions[0].options[0].text = 'x'.repeat(2000);
  const p = open(t, stored, data); choose(p, 2); edit(p, 'Last saved custom draft');
  stored.maxLength = 1000;
  choose(p, 0);
  expectAnswer(p, 0, 'x'.repeat(2000));
  expectAnswer(open(t, stored, data), 2, 'Last saved custom draft');
  // In-memory custom drafts still work when storage refuses every write.
  stored.maxLength = 0; choose(p, 2); edit(p, 'Unsaved local draft'); choose(p, 1); choose(p, 2);
  expectAnswer(p, 2, 'Unsaved local draft');
});

test('interleaved tab saves restore one whole answer from the last successful edit', t => {
  const stored = storage(), a = open(t, stored), b = open(t, stored);
  stored.afterWrite = key => {
    if (key.includes('copied:') || key.includes('open:')) return;
    stored.afterWrite = null;
    choose(b, 2); edit(b, 'Tab B won the last save');
  };
  choose(a, 0);
  expectAnswer(a, 0, 'First plan.');
  expectAnswer(b, 2, 'Tab B won the last save');
  expectAnswer(open(t, stored), 2, 'Tab B won the last save');
});

test('malformed saved choices fall back to the recommendation and preserve legacy draft text', t => {
  for (const pick of ['', ' ', '0x0', '-0', 'Infinity', '1.5', '999', 'NaN']) {
    const stored = storage(); stored.setItem(prefix + 'pick:decision', pick);
    stored.setItem(prefix + 'text:decision', 'Recovered legacy draft');
    expectAnswer(open(t, stored), 1, 'Recovered legacy draft');
  }
});

test('legacy custom drafts migrate on edit without changing defaults, headers or other boards', async t => {
  const stored = storage();
  stored.setItem(prefix + 'pick:decision', '2');
  stored.setItem(prefix + 'text:decision', 'Legacy custom draft');
  stored.setItem(prefix + 'own:decision', 'Legacy custom draft');
  const p = open(t, stored); expectAnswer(p, 2, 'Legacy custom draft');
  choose(p, 0); choose(p, 2); expectAnswer(p, 2, 'Legacy custom draft');
  edit(p, 'Updated draft');
  expectAnswer(open(t, stored), 2, 'Updated draft');
  p.doc.querySelector('.copy').click(); await Promise.resolve();
  assert.ok(p.copies[0].startsWith('Worker\nRe: Which plan?\nUpdated draft\n\n'));
  expectAnswer(open(t, stored, board('separate')), 1, 'Recommended plan.');
});

test('malformed answer records recover from legacy drafts without rewriting stored data', t => {
  const invalid = ['{broken', 'null', '[]', 'true', '"text"',
    JSON.stringify({ version: 99, pick: 0, text: 'Wrong version', own: '' }),
    ...[-1, 3, 0.5, '0', null].map(pick => JSON.stringify({ version: 1, pick, text: 'Wrong selection', own: '' })),
    JSON.stringify({ version: 1, pick: 0, text: ['wrong type'], own: '' }),
    JSON.stringify({ version: 1, pick: 0, text: 'Text', own: null })];
  for (const value of invalid) {
    const stored = storage(); stored.setItem(prefix + 'answer:decision', value);
    stored.setItem(prefix + 'pick:decision', '2');
    stored.setItem(prefix + 'text:decision', 'Recovery draft');
    stored.setItem(prefix + 'own:decision', 'Recovery draft');
    const before = [...stored.values];
    const p = open(t, stored); expectAnswer(p, 2, 'Recovery draft');
    assert.deepEqual([...stored.values], before, 'loading leaves recoverable storage intact');
    edit(p, 'Recovered and saved');
    expectAnswer(open(t, stored), 2, 'Recovered and saved');
  }
});
