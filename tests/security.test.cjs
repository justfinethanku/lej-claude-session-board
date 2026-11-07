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
function data() {
  return { updated: 'test', manager: 'Manager', sessions: [{
    id: 'one', name: 'Session 1', state: 'Ready', questions: []
  }], groups: [{ title: 'Tasks', items: [] }] };
}
function render(value) {
  const json = JSON.stringify(value).replace(/</g, '\\u003c');
  return open(template.replace(block, (_, start, end) => start + json + end));
}
function open(html) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://board.example.test/', virtualConsole: console
  });
  return { dom, errors, document: dom.window.document };
}
function close(t, page) { t.after(() => page.dom.window.close()); return page; }

test('plain labels preserve literal markup and entities alongside recommendation and reminder spans', t => {
  const value = data();
  const text = '<img src=x onerror="window.pwned=1"> &amp; "literal" <b>text</b>';
  const session = value.sessions[0];
  session.name = session.state = session.need = text;
  session.where = [text];
  session.questions = [{ id: 'literal', title: text, note: text, to: text,
    options: [{ label: text, text, rec: true }] }];
  session.reminders = [{ text, when: text }, { text }];
  session.actions = [{ id: 'literal-action', title: text, why: text, steps: [text], text }];
  session.pastes = [{ id: 'literal-paste', title: text, note: text, to: text, text }];
  value.groups[0].title = text;
  value.groups[0].items = [{ text: '<b>Rich prose</b>', starter: { title: 'PRJ5 ' + text, prompt: text } }];
  const page = close(t, render(value));
  const doc = page.document;
  for (const selector of ['.session h2', '.need', '.state', '.where li', '.q-title', '.q-note',
    '.action h3', '.action .q-note', '.action ol li', '.action pre', '.group-head h3']) {
    assert.equal(doc.querySelector(selector).textContent, text, selector);
  }
  const label = doc.querySelector('.opts label > span');
  assert.equal(label.firstChild.textContent, text);
  assert.equal(label.querySelector('.rec').textContent, 'Recommended');
  assert.equal(doc.querySelector('.reminders li').textContent, text + ' · ' + text);
  assert.equal(doc.querySelector('.reminders .when').textContent, '· ' + text);
  assert.equal(doc.querySelectorAll('.reminders li')[1].textContent, text);
  assert.equal(doc.querySelector('.q .to').textContent, 'Paste into ' + text);
  assert.equal(doc.querySelector('#reply-literal').value, text);
  assert.equal(doc.querySelector('.starter-title').textContent, 'PRJ5 ' + text);
  assert.equal(doc.querySelector('.items b').textContent, 'Rich prose');
  assert.equal(doc.querySelector('.wrap img, .wrap [onerror]'), null);
  assert.equal(page.dom.window.pwned, undefined);
  assert.deepEqual(page.errors, []);
});

test('task and backlog formatting cannot install executable elements or attributes', t => {
  const value = data();
  const payload = '<b onclick="window.pwned=1">Bold <code onmouseover="window.pwned=2">code</code></b>' +
    '<img src=x onerror="window.pwned=3"><svg onload="window.pwned=4"></svg>' +
    '<iframe srcdoc="<script>parent.pwned=5</script>"></iframe>' +
    '<a href="javascript:window.pwned=6">unsafe link</a>';
  value.sessions[0].backlog = [payload];
  value.groups[0].items = [{ text: payload }];
  const page = close(t, render(value));
  assert.deepEqual(page.errors, []);
  for (const host of [page.document.querySelector('.backlog li'), page.document.querySelector('.items > li')]) {
    assert.equal(host.querySelector('b').textContent, 'Bold code');
    assert.equal(host.querySelector('code').textContent, 'code');
    assert.equal(host.querySelector('img,svg,iframe,a'), null);
    for (const element of host.querySelectorAll('*')) assert.equal(element.attributes.length, 0);
    host.querySelector('b').click();
    host.querySelector('code').dispatchEvent(new page.dom.window.Event('mouseover'));
  }
  assert.equal(page.dom.window.pwned, undefined);
});

test('action links accept HTTP(S) only, including control-character scheme disguises', t => {
  const value = data();
  const bad = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)',
    'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', '//evil.example/', '/relative'];
  const good = ['https://example.test/setup?a=1&b=2', 'http://localhost:8765/'];
  value.sessions[0].actions = [...bad, ...good].map((link, i) => ({
    id: String(i), title: 'Action ' + i, link, linkText: '<Setup>'
  }));
  const page = close(t, render(value));
  assert.deepEqual(page.errors, []);
  const actions = [...page.document.querySelectorAll('.action')];
  for (const action of actions.slice(0, bad.length)) assert.equal(action.querySelector('a'), null);
  assert.deepEqual(actions.slice(bad.length).map(a => a.querySelector('a').href), good);
  for (const a of page.document.querySelectorAll('.action a')) {
    assert.equal(a.textContent, '<Setup>');
    assert.equal(a.target, '_blank');
    assert.match(a.rel, /noopener/);
    assert.match(a.rel, /noreferrer/);
  }
});

test('builder embeds standalone JSON without closing the HTML script block', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-security-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const value = data();
  value.overview = '</ScRiPt><script>window.pwned=1</script><!-- & <text>';
  value.groups[0].items = [{ text: '<b>Safe</b> & <code>code</code>' }];
  const input = path.join(dir, 'board.json');
  const output = path.join(dir, 'board.html');
  fs.writeFileSync(input, JSON.stringify(value));
  const built = spawnSync('python3', ['scripts/build_local.py', 'assets/board-template.html', output, '--data', input], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const page = close(t, open(fs.readFileSync(output, 'utf8')));
  assert.deepEqual(page.errors, []);
  assert.equal(page.dom.window.pwned, undefined);
  assert.equal(page.document.querySelector('#overview').textContent, value.overview);
  assert.equal(page.document.querySelector('.items b').textContent, 'Safe');
  assert.deepEqual(JSON.parse(page.document.querySelector('#board-data').textContent), value);
  assert.ok(page.document.querySelector('#local-autoreload'));
});

test('demo and legacy two-argument builder keep the board usable', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-legacy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'board.html');
  const built = spawnSync('python3', ['scripts/build_local.py', 'assets/board-template.html', output], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const legacy = close(t, open(fs.readFileSync(output, 'utf8')));
  assert.deepEqual(legacy.errors, []);
  assert.equal(legacy.document.querySelectorAll('.session').length, 2);
  assert.ok(legacy.document.querySelector('.q textarea').value);
  const demo = close(t, render(JSON.parse(fs.readFileSync(path.join(root, 'assets/demo-data.json'), 'utf8'))));
  assert.deepEqual(demo.errors, []);
  assert.ok(demo.document.querySelectorAll('.session').length > 1);
  assert.equal(demo.document.querySelector('.items b').textContent, 'Pick a price');
  assert.ok(demo.document.querySelector('textarea.prompt').value.includes('<context>'));
});


test('builder refuses missing data blocks before changing the output', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-invalid-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'input.html');
  const output = path.join(dir, 'output.html');
  fs.writeFileSync(input, '<h1>No data block</h1>');
  fs.writeFileSync(output, 'existing board');
  const built = spawnSync('python3', ['scripts/build_local.py', input, output, '--data', 'assets/demo-data.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 2);
  assert.match(built.stderr, /exactly one script/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'existing board');
});

test('failed standalone publication preserves the previous board across identities', { skip: process.platform !== 'linux' }, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-rollback-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'board.html'), input = path.join(dir, 'new-board.json');
  const existing = '<h1>Previous board identity and data</h1>';
  fs.writeFileSync(output, existing);
  fs.chmodSync(output, 0o640);
  fs.writeFileSync(input, '{invalid json');
  const args = ['scripts/build_local.py', 'assets/board-template.html', output, '--data', input];
  const invalid = spawnSync('python3', args, { cwd: root, encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /JSONDecodeError/);
  assert.equal(fs.readFileSync(output, 'utf8'), existing);
  const replacement = { ...data(), boardId: 'replacement-board' };
  fs.writeFileSync(input, JSON.stringify(replacement));
  // An OS-enforced file-size limit makes a real partial write fail, without
  // mocking the builder's implementation or filling the host filesystem.
  const script = 'import resource,runpy,signal,sys; ' +
    'resource.setrlimit(resource.RLIMIT_FSIZE,(256,256)); ' +
    'signal.signal(signal.SIGXFSZ,signal.SIG_IGN); ' +
    'sys.argv=["scripts/build_local.py",*sys.argv[1:]]; ' +
    'runpy.run_path(sys.argv[0],run_name="__main__")';
  const built = spawnSync('python3', ['-c', script, 'assets/board-template.html', output, '--data', input], {
    cwd: root, encoding: 'utf8'
  });
  assert.notEqual(built.status, 0);
  assert.match(built.stderr, /File too large/);
  assert.equal(fs.readFileSync(output, 'utf8'), existing);
  assert.equal(fs.statSync(output).mode & 0o777, 0o640);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['board.html', 'new-board.json']);
  const retried = spawnSync('python3', args, { cwd: root, encoding: 'utf8' });
  assert.equal(retried.status, 0, retried.stderr);
  const page = close(t, open(fs.readFileSync(output, 'utf8')));
  assert.deepEqual(page.errors, []);
  assert.deepEqual(JSON.parse(page.document.getElementById('board-data').textContent), replacement);
  assert.equal(fs.statSync(output).mode & 0o777, 0o640);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['board.html', 'new-board.json']);
});
