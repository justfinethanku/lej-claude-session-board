const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const root = process.env.BOARD_ROOT || path.join(__dirname, '..');
const template = fs.readFileSync(path.join(root, 'assets/board-template.html'), 'utf8');
const prefix = 'lej-board:["id","save-recovery"]:';
const board = { boardId: 'save-recovery', manager: 'Manager', projectFolder: '/project', sessions: [{
  id: 'worker', name: 'Worker', questions: [{ id: 'decision', title: 'Choose a plan', note: 'Keep this context.', to: 'Worker',
    options: [{ label: 'First', text: 'First plan', rec: true }, { label: 'Second', text: 'Second plan' }] }],
  pastes: [{ id: 'handoff', title: 'Handoff notes', text: 'Original handoff', to: 'Worker' }]
}], groups: [{ title: 'Build', items: [{ text: 'Build this', starter: { title: 'PRJ1 Build', prompt: 'Original prompt' } }] }] };
function storage() {
  const values = new Map();
  return { values, reject: false, rejectReceipts: false,
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      if ((this.reject && !key.includes(':copied:') && !key.includes(':open:')) || (this.rejectReceipts && key.includes(':copied:'))) throw new Error('QuotaExceededError');
      values.set(key, String(value));
    }
  };
}
function open(t, stored) {
  const html = template.replace(/(id="board-data">)[\s\S]*?(<\/script>)/, (_, a, b) => a + JSON.stringify(board) + b);
  const dom = new JSDOM(html, { url: 'https://board.test/', runScripts: 'dangerously', beforeParse(w) {
    Object.defineProperty(w, 'localStorage', { value: stored });
    Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: () => Promise.resolve() } });
  } });
  t.after(() => dom.window.close());
  dom.window.document.querySelectorAll('details').forEach(d => { d.open = true; });
  return dom.window;
}
function edit(w, field, value) { field.value = value; field.dispatchEvent(new w.Event('input', { bubbles: true })); }
function status(w, field) {
  const descriptions = (field.getAttribute('aria-describedby') || '').split(/\s+/).map(id => w.document.getElementById(id));
  const node = descriptions.find(n => n && n.getAttribute('role') === 'status');
  assert.ok(node, 'save feedback is associated with its field and exposes a live status');
  return node;
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('failed question saves remain visible and announced through copy; retry saves latest text and preserves focus', async t => {
  const stored = storage(), w = open(t, stored), d = w.document, field = d.querySelector('#reply-decision');
  edit(w, field, 'Last saved');
  const lastSaved = stored.values.get(prefix + 'answer:decision');
  stored.reject = true; field.focus(); edit(w, field, 'Unsaved version');
  const feedback = status(w, field);
  assert.match(feedback.textContent, /not saved.*choose a plan/i);
  assert.match(feedback.textContent, /copy.*before.*reload/i);
  assert.equal(feedback.getAttribute('aria-atomic'), 'true');
  assert.equal(d.activeElement, field);
  assert.ok(field.getAttribute('aria-describedby').includes('note-decision'), 'existing note remains associated');
  assert.equal(stored.values.get(prefix + 'answer:decision'), lastSaved);
  const mutations = [], observer = new w.MutationObserver(records => mutations.push(...records));
  observer.observe(feedback, { childList: true, subtree: true, characterData: true });
  edit(w, field, 'Latest unsaved version'); await settle();
  assert.equal(mutations.length, 0, 'repeated rejected keystrokes do not repeat the same live message'); observer.disconnect();
  d.querySelector('.q .copy').click(); await settle();
  assert.match(d.querySelector('#copy-status').textContent, /copied to clipboard/i);
  assert.match(feedback.textContent, /not saved/i, 'clipboard success does not clear the separate save failure');
  const retry = feedback.parentElement.querySelector('button');
  assert.ok(retry && !retry.hidden && retry.type === 'button');
  assert.match(retry.getAttribute('aria-label'), /retry saving.*choose a plan/i);
  retry.focus(); retry.click();
  assert.equal(d.activeElement, retry, 'failed retry keeps the retry control focused');
  stored.reject = false; retry.click();
  assert.match(feedback.textContent, /saved.*choose a plan/i);
  assert.equal(d.activeElement, field, 'successful retry returns focus to its reply when the retry control is removed');
  assert.equal(field.hasAttribute('data-unsaved-draft'), false);
  assert.equal(JSON.parse(stored.values.get(prefix + 'answer:decision')).text, 'Latest unsaved version');
  assert.equal(open(t, stored).document.querySelector('#reply-decision').value, 'Latest unsaved version');
  stored.reject = true; edit(w, field, 'Another outage');
  assert.match(feedback.textContent, /not saved/i, 'a later failure replaces the earlier success');
  assert.equal(field.hasAttribute('data-unsaved-draft'), true);
  assert.equal(retry.hidden, false);
});

test('choice failure and retry save the whole custom draft without moving radio focus', t => {
  const stored = storage(), w = open(t, stored), d = w.document, field = d.querySelector('#reply-decision');
  const radios = d.querySelectorAll('.opts input'), own = radios[2];
  own.checked = true; own.dispatchEvent(new w.Event('change', { bubbles: true })); edit(w, field, 'My custom plan');
  stored.reject = true; radios[1].checked = true; radios[1].focus(); radios[1].dispatchEvent(new w.Event('change', { bubbles: true }));
  const feedback = status(w, field);
  assert.match(feedback.textContent, /not saved/i);
  assert.equal(d.activeElement, radios[1]);
  const group = d.querySelector('fieldset');
  assert.ok(group.getAttribute('aria-describedby').includes(feedback.id), 'choice group also describes the save failure');
  stored.reject = false; feedback.parentElement.querySelector('button').click();
  const saved = JSON.parse(stored.values.get(prefix + 'answer:decision'));
  assert.deepEqual(saved, { version: 1, pick: 1, text: 'Second plan', own: 'My custom plan' });
  assert.equal(d.activeElement, radios[1], 'a programmatic retry never steals unrelated focus');
});

test('handoffs and starter prompts each retain independent save failures until their own recovery', t => {
  const stored = storage(), w = open(t, stored), d = w.document;
  const handoff = d.querySelector('#paste-handoff'), starter = d.querySelector('textarea.prompt[id^="prompt-"]');
  stored.reject = true; edit(w, handoff, 'Unsent handoff'); edit(w, starter, 'Unsent prompt');
  const handoffStatus = status(w, handoff), starterStatus = status(w, starter);
  assert.notEqual(handoffStatus.id, starterStatus.id);
  assert.match(handoffStatus.textContent, /not saved.*handoff notes/i);
  assert.match(starterStatus.textContent, /not saved.*prj1 build/i);
  stored.reject = false; handoffStatus.parentElement.querySelector('button').click();
  assert.equal(stored.values.get(prefix + 'text:paste:handoff'), 'Unsent handoff');
  assert.equal(handoff.hasAttribute('data-unsaved-draft'), false);
  assert.equal(starter.hasAttribute('data-unsaved-draft'), true, 'saving one field cannot clear another pending failure');
  edit(w, starter, 'Recovered prompt');
  assert.equal(starter.hasAttribute('data-unsaved-draft'), false);
  assert.match(starterStatus.textContent, /saved.*prj1 build/i);
  const restored = open(t, stored).document;
  assert.equal(restored.querySelector('#paste-handoff').value, 'Unsent handoff');
  assert.equal(restored.querySelector('textarea.prompt[id^="prompt-"]').value, 'Recovered prompt');
});

test('receipt-only failures never label a successfully saved draft unsaved', t => {
  const stored = storage(), w = open(t, stored), field = w.document.querySelector('#reply-decision');
  stored.rejectReceipts = true; edit(w, field, 'Saved draft');
  assert.equal(field.hasAttribute('data-unsaved-draft'), false);
  const messages = [...w.document.querySelectorAll('[role="status"]')].map(n => n.textContent);
  assert.ok(messages.every(text => !/not saved/i.test(text)));
  assert.equal(JSON.parse(stored.values.get(prefix + 'answer:decision')).text, 'Saved draft');
});

const result = spawnSync('python3', ['-c', 'import runpy,json; print(json.dumps(runpy.run_path("scripts/build_local.py")["RELOAD"]))'], { cwd: root, encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
const reload = JSON.parse(result.stdout).replace(/^<script[^>]*>|<\/script>$/g, '').replace('location.reload();', 'window.reloads += 1;');
test('timed refresh preserves failed drafts after focus leaves and resumes only when every draft is saved', t => {
  const stored = storage(), w = open(t, stored), d = w.document;
  w.clock = 0; w.reloads = 0; w.Date.now = () => w.clock;
  w.setInterval = cb => { w.tick = cb; };
  w.eval(reload);
  const field = d.querySelector('#reply-decision'), handoff = d.querySelector('#paste-handoff');
  stored.reject = true; edit(w, field, 'Preserve reply'); edit(w, handoff, 'Preserve handoff'); field.blur();
  w.clock = 60000; w.tick(); assert.equal(w.reloads, 0, 'reading elsewhere must not discard unsaved fields');
  stored.reject = false; status(w, field).parentElement.querySelector('button').click();
  w.clock = 120000; w.tick(); assert.equal(w.reloads, 0, 'another unsaved field still blocks timed refresh');
  status(w, handoff).parentElement.querySelector('button').click();
  w.clock = 180000; w.tick(); assert.equal(w.reloads, 1, 'timer resumes after all failures recover');
});
