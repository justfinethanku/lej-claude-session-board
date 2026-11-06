// Development-only renderer benchmark. No browser/network/GPU work is performed.
// Optional baseline path compares both renderers in alternating order and checks
// their rendered DOM/field values match. Timings are jsdom CPU, not browser paint.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const current = fs.readFileSync(path.join(root, 'assets/board-template.html'), 'utf8');
const sources = process.argv[2]
  ? { baseline: fs.readFileSync(process.argv[2], 'utf8'), current }
  : { current };
const demo = JSON.parse(fs.readFileSync(path.join(root, 'assets/demo-data.json'), 'utf8'));
const board = {
  boardId: 'benchmark', updated: 'Synthetic benchmark', updatedISO: '2026-11-06T00:00:00Z',
  manager: 'Manager', projectFolder: '/synthetic/project', overview: 'Rendering benchmark.',
  todoIntro: 'Synthetic tasks',
  sessions: Array.from({ length: 28 }, (_, i) => ({
    id: 's' + i, name: 'PRJ' + i + ' Session', state: 'Needs a decision',
    where: ['One workstream is ready.', 'Another check is running.'],
    questions: Array.from({ length: 2 }, (_, j) => ({
      id: 'q' + i + '-' + j, title: 'Choose next step ' + j, to: 'PRJ' + i,
      options: [{ label: 'Proceed', text: 'Proceed with the work.', rec: true },
        { label: 'Wait', text: 'Wait for more evidence.' }]
    })),
    actions: [{ id: 'a' + i, title: 'Configure account', why: 'Allow access.',
      link: 'https://example.test/setup', steps: ['Open settings', 'Save the change'], text: 'Setup text' }],
    reminders: [{ text: 'Check the result', when: 'Later today' }],
    pastes: [{ id: 'p' + i, title: 'Handoff', to: 'Other machine', text: 'Continue here.' }],
    backlog: ['<b>Next task</b> with <code>details</code>']
  })),
  groups: [{ title: 'Build next', items: Array.from({ length: 20 }, (_, i) => ({
    text: '<b>Task ' + i + '</b>',
    starter: { title: 'NEXT' + i + ' Build', prompt: 'Build the next task.' }
  })) }]
};

function render(template, data) {
  const html = template.replace(/(<script\b[^>]*id="board-data"[^>]*>)[\s\S]*?(<\/script>)/i,
    (_, start, end) => start + JSON.stringify(data).replace(/</g, '\\u003c') + end);
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(html, { url: 'https://board.example.test/', runScripts: 'outside-only', virtualConsole: vc });
  const { window } = dom;
  let htmlWrites = 0;
  const descriptor = Object.getOwnPropertyDescriptor(window.Element.prototype, 'innerHTML');
  Object.defineProperty(window.Element.prototype, 'innerHTML', {
    ...descriptor, set(value) { htmlWrites++; descriptor.set.call(this, value); }
  });
  // Hold time constant for the staleness text; never include setup or snapshot
  // serialization in the measured interval. No external resources are loaded.
  window.Date.now = () => Date.parse('2026-11-06T12:00:00Z');
  const script = [...window.document.scripts].find(s => !s.type).textContent;
  const start = performance.now();
  window.eval(script);
  const ms = performance.now() - start;
  const wrap = window.document.querySelector('.wrap');
  // normalize() treats adjacent text nodes as equivalent (e.g. reminder labels).
  wrap.normalize();
  const snapshot = { html: wrap.outerHTML,
    values: [...wrap.querySelectorAll('textarea,input')].map(n => [n.id, n.value, n.checked]) };
  const elements = wrap.querySelectorAll('*').length;
  window.close();
  assert.deepEqual(errors, []);
  return { ms, htmlWrites, elements, snapshot };
}

const results = {};
for (const [name, fixture] of Object.entries({ demo, '28-session': board })) {
  const samples = Object.fromEntries(Object.keys(sources).map(key => [key, []]));
  let reference;
  for (let round = 0; round < 12; round++) {
    const order = Object.entries(sources);
    if (round % 2) order.reverse();
    for (const [label, template] of order) {
      const value = render(template, fixture);
      if (!reference) reference = value.snapshot;
      assert.deepEqual(value.snapshot, reference, name + ' rendered content changed');
      if (round >= 3) samples[label].push(value);
    }
  }
  results[name] = Object.fromEntries(Object.entries(samples).map(([label, rows]) => {
    const times = rows.map(v => v.ms).sort((a, b) => a - b);
    return [label, { median_ms: +times[4].toFixed(3), min_ms: +times[0].toFixed(3),
      max_ms: +times.at(-1).toFixed(3), html_parser_calls: rows[0].htmlWrites,
      elements: rows[0].elements, samples_ms: rows.map(v => +v.ms.toFixed(3)) }];
  }));
}
console.log(JSON.stringify({ node: process.version, jsdom: require('jsdom/package.json').version,
  warmups: 3, samples: 9, alternating_order: true, rendered_content_equal: true,
  limitation: 'Synthetic jsdom renderer CPU; excludes HTML page parse, layout, paint, network and browser-specific costs.', results }, null, 2));
