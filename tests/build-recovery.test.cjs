const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.resolve(__dirname, '..');
function board(boardId = 'alpha') {
  return { boardId, manager: 'Manager', updated: 'test', sessions: [{
    id: 'worker', name: 'Worker', state: 'Waiting', questions: [{
      id: 'decision', title: 'Proceed?', to: 'Worker',
      options: [{ label: 'Wait', text: 'Wait.', rec: true }]
    }]
  }], groups: [{ title: 'Builds', items: [{ text: 'Build',
    starter: { title: 'PRJ5 Build', prompt: 'Build safely.' } }] }] };
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-import-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'board.json'), output = path.join(dir, 'board.html');
  function build(data) {
    fs.writeFileSync(input, JSON.stringify(data));
    return spawnSync('python3', ['scripts/build_local.py', 'assets/board-template.html', output, '--data', input], {
      cwd: root, encoding: 'utf8', timeout: 10000
    });
  }
  assert.equal(build(board()).status, 0);
  fs.chmodSync(output, 0o640);
  const previous = fs.readFileSync(output);
  function preserved() {
    assert.deepEqual(fs.readFileSync(output), previous, 'last usable page bytes survive');
    assert.equal(fs.statSync(output).mode & 0o777, 0o640);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['board.html', 'board.json']);
  }
  return { build, output, preserved };
}
function open(t, output, stored = new Map()) {
  const errors = [], copies = [], vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(fs.readFileSync(output, 'utf8'), {
    url: 'https://board.example.test/board.html', runScripts: 'dangerously', virtualConsole: vc,
    beforeParse(w) {
      Object.defineProperty(w, 'localStorage', { value: {
        getItem: key => stored.has(key) ? stored.get(key) : null,
        setItem: (key, value) => stored.set(key, String(value))
      } });
      Object.defineProperty(w.navigator, 'clipboard', { value: {
        writeText: text => { copies.push(text); return Promise.resolve(); }
      } });
    }
  });
  t.after(() => dom.window.close());
  assert.deepEqual(errors, [], 'published page renders without script errors');
  return { window: dom.window, doc: dom.window.document, copies };
}

test('invalid root and collection imports cannot replace a usable board', t => {
  const f = fixture(t);
  for (const [data, location] of [
    [null, '$'], [[], '$'], [true, '$'],
    [{ ...board('beta'), sessions: {} }, '$.sessions'],
    [{ ...board('beta'), groups: null }, '$.groups'],
    [{ ...board('beta'), sessions: [null] }, '$.sessions[0]']
  ]) {
    const result = f.build(data);
    assert.equal(result.status, 2, 'invalid import must fail: ' + location);
    assert.ok(result.stderr.includes(location), result.stderr);
    assert.doesNotMatch(result.stdout, /wrote/);
    f.preserved();
  }
  open(t, f.output);
});

test('partial nested data imports fail before publication with a useful field path', t => {
  const f = fixture(t);
  for (const [change, location] of [
    [b => { b.sessions[0].questions = {}; }, '$.sessions[0].questions'],
    [b => { b.sessions[0].questions[0].options = 'unfinished'; }, '$.sessions[0].questions[0].options'],
    [b => { b.sessions[0].questions[0].options = [null]; }, '$.sessions[0].questions[0].options[0]'],
    [b => { b.sessions[0].questions[0].options[0].text = {}; }, '$.sessions[0].questions[0].options[0].text'],
    [b => { b.sessions[0].where = { partial: true }; }, '$.sessions[0].where'],
    [b => { b.sessions[0].actions = [{ id: 'setup', title: 'Setup', steps: {} }]; }, '$.sessions[0].actions[0].steps'],
    [b => { b.sessions[0].pastes = [null]; }, '$.sessions[0].pastes[0]'],
    [b => { b.sessions[0].reminders = ['unfinished']; }, '$.sessions[0].reminders[0]'],
    [b => { b.groups[0].items = {}; }, '$.groups[0].items'],
    [b => { b.groups[0].items[0].starter.title = { private: 'SYNTHETIC_PRIVATE_MARKER' }; }, '$.groups[0].items[0].starter.title']
  ]) {
    const data = board('beta'); change(data);
    const result = f.build(data);
    assert.equal(result.status, 2, 'invalid import must fail: ' + location);
    assert.ok(result.stderr.includes(location), result.stderr);
    assert.doesNotMatch(result.stderr, /SYNTHETIC_PRIVATE_MARKER/);
    f.preserved();
  }
});

test('duplicate question ids across sessions or groups cannot alias saved replies', t => {
  const f = fixture(t);
  for (const inGroup of [false, true]) {
    const data = board('beta'), duplicate = structuredClone(data.sessions[0].questions[0]);
    duplicate.title = 'A different question';
    if (inGroup) data.groups[0].items.push({ text: 'Your call', question: duplicate });
    else data.sessions.push({ id: 'second', name: 'Second worker', questions: [duplicate] });
    const result = f.build(data);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /duplicate question id/);
    f.preserved();
  }
});

test('repeated refused imports, corrected publication and identity round trips preserve drafts', async t => {
  const f = fixture(t), stored = new Map(), alpha = open(t, f.output, stored);
  const reply = alpha.doc.querySelector('#reply-decision'); reply.value = 'Alpha saved draft';
  reply.dispatchEvent(new alpha.window.Event('input', { bubbles: true }));
  const saved = [...stored];
  const beta = board('beta'); beta.sessions[0].questions = { incomplete: true };
  for (let n = 0; n < 2; n++) {
    assert.equal(f.build(beta).status, 2); f.preserved();
    assert.equal(open(t, f.output, stored).doc.querySelector('#reply-decision').value, 'Alpha saved draft');
    assert.deepEqual([...stored], saved, 'failed import/reload leaves stored answers intact');
  }
  const corrected = board('beta');
  // Unknown metadata and optional empty lists are valid, not an exhaustive schema gate.
  corrected.extension = { revision: 1 };
  corrected.sessions[0].questions[0].options = [];
  corrected.sessions[0].actions = []; corrected.sessions[0].pastes = null;
  assert.equal(f.build(corrected).status, 0);
  const next = open(t, f.output, stored);
  assert.equal(next.doc.querySelector('#reply-decision').value, '');
  assert.deepEqual([...stored], saved, 'new identity does not rewrite alpha state');
  const publishedBeta = fs.readFileSync(f.output);
  // A late invalid import cannot roll the corrected board back to an older identity.
  const late = board(); late.groups[0].items = { incomplete: true };
  assert.equal(f.build(late).status, 2);
  assert.deepEqual(fs.readFileSync(f.output), publishedBeta);
  assert.equal(open(t, f.output, stored).doc.querySelector('#reply-decision').value, '');
  assert.equal(f.build(board()).status, 0);
  const restored = open(t, f.output, stored);
  assert.equal(restored.doc.querySelector('#reply-decision').value, 'Alpha saved draft');
  restored.doc.querySelector('.q .copy').click(); await Promise.resolve();
  assert.ok(restored.copies[0].includes('Alpha saved draft'));
  assert.equal(fs.statSync(f.output).mode & 0o777, 0o640);
});
