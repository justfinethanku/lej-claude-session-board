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
