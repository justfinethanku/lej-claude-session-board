// Saved-state restore benchmark; no browser, network or production data.
// node scripts/benchmark_restore.cjs [baseline-template.html]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const current = path.join(root, 'assets/board-template.html');
const prefix = 'lej-board:["id","restore-benchmark"]:';
const fixtures = {
  short: { chars: 256, history: 0, receipt: null },
  long: { chars: 16384, history: 0, receipt: null },
  'long-history': { chars: 16384, history: 4000, receipt: null },
  cleared: { chars: 16384, history: 4000, receipt: '' },
  'malformed-answer': { chars: 16384, history: 4000, receipt: '', malformedAnswer: true },
  malformed: { chars: 16384, history: 4000, receipt: '{broken' },
  copied: { chars: 16384, history: 4000, receipt: 'matching' }
};

function fixture(config) {
  const stored = new Map();
  const unit = 'Reply "quoted" \\ line\n';
  const draft = unit.repeat(Math.ceil(config.chars / unit.length)).slice(0, config.chars);
  const data = { boardId: 'restore-benchmark', updated: 'Synthetic benchmark',
    manager: 'Manager', reportBack: 'Report back.', groups: [],
    sessions: Array.from({ length: 28 }, (_, i) => ({
      id: 's' + i, name: 'Worker ' + i, state: 'Waiting',
      questions: [0, 1].map(j => ({ id: `q${i}-${j}`, title: 'Decision ' + j,
        to: 'Worker ' + i, options: [{ label: 'Wait', text: 'Wait.', rec: true }] }))
    })) };
  for (let i = 0; i < config.history; i++) {
    stored.set((i % 2 ? prefix : 'lej-board:["id","past-board"]:') + 'answer:old-' + i, 'Historical draft ' + i);
  }
  for (const session of data.sessions) {
    const replies = [];
    for (const q of session.questions) {
      stored.set(prefix + 'answer:' + q.id, JSON.stringify({ version: 1, pick: 1, text: draft, own: draft }));
      if (config.malformedAnswer) {
        stored.set(prefix + 'answer:' + q.id, '{broken');
        stored.set(prefix + 'pick:' + q.id, '1');
        stored.set(prefix + 'text:' + q.id, draft);
        stored.set(prefix + 'own:' + q.id, draft);
      }
      replies.push('Re: ' + q.title + '\n' + draft.trim());
      const text = session.name + '\nRe: ' + q.title + '\n' + draft.trim() + '\n\nReport back.';
      if (config.receipt !== null) stored.set(prefix + 'copied:q:' + q.id,
        config.receipt === 'matching' ? JSON.stringify([1, text]) : config.receipt);
    }
    if (config.receipt !== null) stored.set(prefix + 'copied:all:' + session.questions.map(q => q.id).join('+'),
      config.receipt === 'matching' ? JSON.stringify([1, session.name + '\n\n' + replies.join('\n\n') + '\n\nReport back.']) : config.receipt);
  }
  return { data, stored };
}

function render(template, config) {
  const { data, stored } = fixture(config);
  const html = template.replace(/(<script\b[^>]*id="board-data"[^>]*>)[\s\S]*?(<\/script>)/i,
    (_, start, end) => start + JSON.stringify(data) + end);
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(html, { url: 'https://board.example.test/', runScripts: 'outside-only', virtualConsole: vc });
  const w = dom.window;
  const counts = { storage_reads: 0, storage_writes: 0, storage_enumerations: 0,
    receipt_serializations: 0, receipt_code_units: 0 };
  Object.defineProperty(w, 'localStorage', { value: {
    get length() { counts.storage_enumerations++; return stored.size; },
    key(index) { counts.storage_enumerations++; return [...stored.keys()][index] ?? null; },
    getItem(key) { counts.storage_reads++; return stored.has(key) ? stored.get(key) : null; },
    setItem(key, value) { counts.storage_writes++; stored.set(key, String(value)); }
  } });
  const stringify = w.JSON.stringify;
  w.JSON.stringify = function (value, ...args) {
    if (Array.isArray(value) && value[0] === 1 && typeof value[1] === 'string') {
      counts.receipt_serializations++; counts.receipt_code_units += value[1].length;
    }
    return stringify.call(this, value, ...args);
  };
  w.Date.now = () => 0;
  const script = [...w.document.scripts].find(s => !s.type).textContent;
  const start = performance.now();
  w.eval(script);
  const ms = performance.now() - start;
  assert.deepEqual(errors, []);
  assert.equal(counts.storage_writes, 0, 'restore must not rewrite saved data');
  const wrap = w.document.querySelector('.wrap');
  const snapshot = JSON.stringify([wrap.outerHTML,
    [...wrap.querySelectorAll('textarea,input')].map(n => [n.id, n.value, n.checked])]);
  const digest = crypto.createHash('sha256').update(snapshot).digest('hex');
  const copied = wrap.querySelectorAll('.copy.was').length;
  assert.equal(copied, config.receipt === 'matching' ? 84 : 0);
  assert.equal(w.document.querySelector('#reply-q0-0').value, stored.get(prefix + 'text:q0-0') || JSON.parse(stored.get(prefix + 'answer:q0-0')).text);
  w.close();
  return { ms, ...counts, digest, copied };
}

if (process.argv[2] === '--worker') {
  // Each version/fixture gets a fresh process; peak RSS includes jsdom/setup and
  // all iterations, not just the timed renderer. It is not a browser memory cost.
  const template = fs.readFileSync(process.argv[3], 'utf8');
  const config = fixtures[process.argv[4]], rows = [];
  for (let round = 0; round < 8; round++) {
    global.gc();
    const result = render(template, config);
    if (round >= 3) rows.push(result);
  }
  assert.ok(rows.every(row => row.digest === rows[0].digest));
  const times = rows.map(row => row.ms).sort((a, b) => a - b);
  const { ms, ...operations } = rows[0];
  console.log(JSON.stringify({ median_ms: times[2], samples_ms: rows.map(row => row.ms),
    peak_rss_kib: process.resourceUsage().maxRSS, ...operations }));
} else {
  const versions = process.argv[2] ? { baseline: path.resolve(process.argv[2]), current } : { current };
  const results = {};
  for (const [index, name] of Object.keys(fixtures).entries()) {
    const order = Object.entries(versions);
    if (index % 2) order.reverse();
    results[name] = {};
    let digest;
    for (const [version, template] of order) {
      const child = spawnSync(process.execPath, ['--expose-gc', __filename, '--worker', template, name],
        { encoding: 'utf8', timeout: 120000 });
      assert.equal(child.status, 0, child.stderr || String(child.error));
      const row = JSON.parse(child.stdout);
      if (digest) assert.equal(row.digest, digest, 'rendered state differs for ' + name);
      digest = row.digest;
      results[name][version] = row;
    }
  }
  console.log(JSON.stringify({ node: process.version, jsdom: require('jsdom/package.json').version,
    warmups: 3, samples: 5, questions: 56, fixtures, equal_dom_and_fields: true,
    limitations: 'Synthetic jsdom renderer CPU with Map storage; excludes page parse, disk, layout, paint, OS clipboard and real browser scheduling. Peak RSS is the entire fresh worker process in KiB, including fixtures and jsdom, not isolated renderer allocation.',
    results }, null, 2));
}
