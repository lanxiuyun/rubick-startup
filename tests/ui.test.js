const assert = require('assert');

async function main() {
  const { visible, listRows, INPUT_ROW_ID, prune, groupCounts, guessKind, normalizePath, keyName, nextSelection, ROW_H, LIMIT, KEY } = await import('../src/model.mjs');
  assert.strictEqual(KEY, 'rubick-startup/history-v2');
  assert.strictEqual(ROW_H, 56);
  assert.strictEqual(LIMIT, 500);
  const records = [
    { id: 'old', command: 'ipconfig /all', time: 1, groups: ['网络', '系统'] },
    { id: 'new', command: 'notepad', time: 3, groups: [] },
    { id: 'path', command: 'D:\\Projects', time: 2, groups: ['开发'] }
  ];
  assert.deepStrictEqual(visible(records).map(record => record.id), ['new', 'path', 'old']);
  assert.strictEqual(visible(records, 'ipcf')[0].id, 'old');
  assert.strictEqual(visible(records, '网络')[0].id, 'old');
  assert.strictEqual(visible(records, '', '开发')[0].id, 'path');
  assert.strictEqual(visible(records, 'unmatched').length, 0);
  assert.deepStrictEqual(listRows(records, 'note').map(record => record.command), ['note', 'notepad']);
  assert.strictEqual(listRows(records, 'unmatched', '开发')[0].id, INPUT_ROW_ID);
  assert.strictEqual(listRows(records, '').length, records.length);
  assert.strictEqual(records.length, 3, 'Input row must not mutate stored history');
  assert.strictEqual(records[0].id, 'old', 'Sorting must not mutate stored records');
  const many = Array.from({ length: 760 }, (_, i) => ({ id: String(i), command: String(i), time: i, groups: i < 260 ? ['saved'] : [] }));
  const kept = prune([...many, { id: 'extra', command: 'extra', time: -1, groups: [] }]);
  assert.strictEqual(kept.length, 760);
  assert.strictEqual(kept.filter(record => record.groups.length).length, 260);
  assert(!kept.some(record => record.id === 'extra'));
  const counts = new Map(groupCounts(records, ['空标签']));
  assert.strictEqual(counts.get('开发'), 1);
  assert.strictEqual(counts.get('空标签'), 0);
  assert.strictEqual(guessKind('https://example.com'), 'url');
  assert.strictEqual(guessKind('D:\\Projects'), 'path');
  assert.strictEqual(guessKind('C:/dlcv/datasets/balloon'), 'path');
  assert.strictEqual(normalizePath('C:/dlcv/datasets/balloon'), 'C:\\dlcv\\datasets\\balloon');
  assert.strictEqual(normalizePath('C:\\\\dlcv\\\\datasets\\\\balloon'), 'C:\\dlcv\\datasets\\balloon');
  assert.strictEqual(normalizePath('C:/dlcv\\datasets/balloon'), 'C:\\dlcv\\datasets\\balloon');
  assert.strictEqual(normalizePath('\\\\\\\\server\\\\share\\\\folder'), '\\\\server\\share\\folder');
  assert.strictEqual(guessKind('notepad'), 'command');
  for (const [keyCode, expected] of [[13, 'enter'], [38, 'up'], [40, 'down'], [27, 'escape']]) assert.strictEqual(keyName({ keyCode }), expected);
  assert.strictEqual(keyName({ code: 'NumpadEnter' }), 'enter');
  assert.strictEqual(nextSelection(0, 1, 3), 1);
  assert.strictEqual(nextSelection(0, -1, 3), 0);
  assert.strictEqual(nextSelection(2, 1, 3), 2);
  assert.strictEqual(nextSelection(-1, 1, 3), 0);
  assert.strictEqual(nextSelection(-1, -1, 3), 2);
  assert.strictEqual(nextSelection(-1, 1, 0), -1);
  console.log('PASS record model: history key, fuzzy filtering, recency, retention, tags, synthetic keys and selection bounds');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
