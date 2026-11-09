const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const app = read('src/StartupApp.tsx');
const runtime = read('src/runtime.ts');
const css = read('src/style.css');
const model = read('src/model.mjs');
const html = read('public/index.html');
assert(app.includes('Dropdown') && app.includes('Tag') && app.includes('Input'), 'UI must use Ant Design components');
assert(!app.includes('innerHTML'), 'React must own the DOM');
for (const id of ['query', 'run', 'echo', 'keyhint', 'count', 'sectionTitle', 'status']) {
  assert(!app.includes(`id="${id}"`), `Removed UI returned: ${id}`);
}
for (const id of ['tags', 'list', 'spacer', 'tagAdd']) assert(app.includes(`id="${id}"`), `Missing ${id}`);
assert(/\.list\{[^}]*overflow-y:auto/.test(css), 'List must scroll');
assert(model.includes('ROW_H = 56') && app.includes('height: ROW_H'), 'Rows must have constant height');
assert(app.includes('tags.slice(0, 2)') && app.includes('tags.length - 2'), 'Tags must collapse');
assert(app.includes('id="tagOverview"') && app.includes('className="tag-grid"'), 'Tag overview popover missing');
assert(/\.tags\{[^}]*overflow-x:auto/.test(css) && css.includes('.tags:hover') && css.includes('.tag-grid'), 'Tag strip must scroll horizontally with a hover scrollbar and a grid overview');
assert(app.includes('setSubInput(') && app.includes("addEventListener('keydown'"), 'Host input channels missing');
assert(app.includes("setSubInputValue('')"), 'Execution must clear host input');
assert(runtime.includes("'child_process'") && runtime.includes('windowsHide: true'), 'Execution contract missing');
assert(html.includes('id="root"') && html.includes('<script'), 'Build output missing');
assert(!/<script[^>]+src=/.test(html) && !/<link[^>]+href=/.test(html), 'Build must bundle scripts/styles for offline file loading');
console.log('PASS React UI, Ant Design, fixed-height virtualization, input channels and offline bundle');
