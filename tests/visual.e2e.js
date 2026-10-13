const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const records = [
  { id: 'a', command: 'ipconfig /all', kind: 'command', groups: ['IP查询', '网络', '系统'] },
  { id: 'b', command: 'D:\\Projects\\ClientApp', kind: 'path', groups: ['项目文件夹', '开发'] },
  { id: 'c', command: 'calc', kind: 'command', groups: ['系统', '实用工具'] },
  { id: 'd', command: 'notepad', kind: 'command', groups: ['办公'] },
  { id: 'e', command: 'https://example.com/docs/reference/integration/getting-started', kind: 'url', groups: ['开发', '文档'] },
  { id: 'f', command: 'powershell -NoProfile -Command "Get-Process | Sort-Object CPU -Descending"', kind: 'command', groups: [] }
].map((record, index) => ({ ...record, time: Date.now() - index * 60000 }));

function adapter(seed) {
  const persisted = sessionStorage.getItem('reload-fixture') ? JSON.parse(sessionStorage.getItem('history-fixture') || 'null') : null;
  sessionStorage.removeItem('reload-fixture');
  window.saved = persisted?.records ?? seed;
  window.savedGroups = persisted?.groups;
  window.launched = [];
  window.exited = 0;
  window.fileLogs = [];
  window.openedPaths = [];
  window.directories = ['Z:\\示例项目\\底部检测\\1-训练集', 'D:\\Projects\\ClientApp'];
  window.copied = [];
  window.clock = Date.now();
  window.__rubickStartupNow = () => window.clock;
  window.rubick = {
    db: { get: () => ({ _rev: '1-test', records: window.saved, groups: window.savedGroups }), put: doc => {
      window.saved = doc.records; window.savedGroups = doc.groups; window.revision = doc._rev;
      sessionStorage.setItem('history-fixture', JSON.stringify(doc));
    } },
    setSubInput: callback => { window.search = callback; },
    setSubInputValue: value => { window.cleared = value; window.search({ text: value }); },
    onPluginReady: callback => { window.ready = callback; }, setExpendHeight: () => {},
    outPlugin: () => { window.exited++; }
  };
  window.require = name => {
    if (name === 'path') return { join: (...parts) => parts.join('/') };
    if (name === 'os') return { tmpdir: () => '/test-temp' };
    if (name === 'fs') return {
      appendFileSync: (file, text) => window.fileLogs.push({ file, text }),
      existsSync: () => false,
      statSync: target => {
        if (!window.directories.includes(target)) throw new Error('ENOENT');
        return { isDirectory: () => true };
      }
    };
    if (name === 'electron') return {
      clipboard: { writeText: text => window.copied.push(text) },
      shell: { openPath: async target => { window.openedPaths.push(target); return window.openPathError || ''; } }
    };
    if (name !== 'child_process') throw new Error('Isolated browser test');
    return { spawn: (exe, args, options) => {
      if (window.throwSpawn) throw new Error('模拟启动失败');
      window.launched.push({ exe, args, options });
      const child = { once: (type, callback) => {
        if (type === (window.failSpawn ? 'error' : 'spawn')) setTimeout(() => callback(window.failSpawn ? new Error('模拟进程错误') : undefined), 0);
        if (type === 'close' && !window.failSpawn && !window.pendingCommand) setTimeout(() => callback(window.exitCode || 0, null), 10);
        return child;
      }, stderr: { on: (type, callback) => { if (window.commandError) callback(new TextEncoder().encode(window.commandError)); } }, unref: () => { window.unreffed = true; } };
      return child;
    } };
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const output = path.join(ROOT, '.visual-qa');
  fs.mkdirSync(output, { recursive: true });
  const errors = [];
  const url = pathToFileURL(path.join(ROOT, 'public/index.html')).href;
  const page = await browser.newPage({ viewport: { width: 800, height: 570 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(adapter, records);
  const boot = async () => { await page.goto(url); await page.locator('.row').first().waitFor(); };
  const key = async keyCode => {
    await page.evaluate(code => document.body.dispatchEvent(new KeyboardEvent('keydown', { keyCode: code, bubbles: true, cancelable: true })), keyCode);
  };
  const search = async text => { await page.evaluate(value => window.search({ text: value }), text); };
  const menuClick = async text => { await page.getByRole('menuitem').filter({ hasText: new RegExp(`^${text}$`) }).click(); };
  try {
    await boot();
    assert.strictEqual(await page.locator('.row.sel').getAttribute('data-id'), 'a');
    assert.strictEqual(await page.locator('.row.sel').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(234, 243, 255)', 'Selected rows must use the blue theme');
    assert.strictEqual(await page.locator('.tag.on').evaluate(el => getComputedStyle(el).color), 'rgb(22, 104, 220)');
    await page.locator('.tag.on').focus();
    assert(await page.locator('.tag.on').evaluate(el => {
      const style = getComputedStyle(el);
      return style.borderTopColor === 'rgba(0, 0, 0, 0)' && style.outlineStyle === 'none' && style.boxShadow === 'none';
    }), 'Selected filter must not show a border or focus ring');
    await page.locator('.tag.on').evaluate(el => el.blur());
    await key(13);
    await page.waitForFunction(() => window.launched.length === 1);
    assert.strictEqual(await page.evaluate(() => window.launched[0].args.at(-1)), 'ipconfig /all');
    await page.waitForFunction(() => window.exited === 1);
    assert(await page.evaluate(() => window.fileLogs.some(entry => entry.file.endsWith('rubick-startup.log') && entry.text.includes('cmd-close'))));
    assert.strictEqual(await page.evaluate(() => window.cleared), '');
    assert.strictEqual(await page.locator('.row.sel').count(), 0);
    await page.evaluate(() => { window.clock += 500; });
    await key(13);
    assert.strictEqual(await page.evaluate(() => window.launched.length), 1, 'Second Enter must not repeat execution');
    await page.evaluate(() => window.ready());
    assert.strictEqual(await page.locator('.row.sel').getAttribute('data-id'), 'a');
    await key(40);
    assert.strictEqual(await page.locator('.row.sel').getAttribute('data-id'), 'b');
    await search('notepad');
    assert.strictEqual(await page.locator('.row').count(), 1);
    assert.strictEqual(await page.locator('.row.sel').getAttribute('data-id'), 'd', 'Search results must keep the first matching row selected');
    await page.evaluate(() => window.ready());
    assert.strictEqual(await page.locator('.row.sel').getAttribute('data-id'), 'd', 'Plugin reinitialization must preserve a selected search result');
    await page.evaluate(() => { window.clock += 500; });
    await key(13);
    await page.waitForFunction(() => window.launched.length === 2);
    assert.strictEqual(await page.evaluate(() => window.launched[1].args.at(-1)), 'notepad');
    assert.strictEqual(await page.evaluate(() => window.revision), '1-test');

    await boot();
    await search('Z:\\示例项目\\底部检测\\1-训练集');
    await key(13);
    await page.waitForFunction(() => window.launched.length === 1);
    assert.strictEqual(await page.evaluate(() => window.launched[0].exe), 'explorer.exe', 'Folder input must open in Explorer instead of running as a cmd command');
    assert.deepStrictEqual(await page.evaluate(() => window.launched[0].args), ['Z:\\示例项目\\底部检测\\1-训练集']);
    assert.strictEqual(await page.evaluate(() => window.cleared), '');
    await page.waitForFunction(() => window.exited === 1);
    const traces = await page.evaluate(() => window.fileLogs.map(entry => entry.text).join('\n'));
    for (const stage of ['request', 'stat', 'explorer-request', 'explorer-spawn', 'result', 'plugin-exit']) assert(traces.includes(stage), `Missing file diagnostic: ${stage}`);

    for (const target of ['Z:\\示例项目\\训练 数据 & 结果', '\\\\server\\share\\示例目录', '"Z:\\示例项目\\带 空格"']) {
      await boot();
      const unquoted = target.startsWith('"') ? target.slice(1, -1) : target;
      await page.evaluate(value => { window.directories.push(value); }, unquoted);
      await search(target);
      await key(13);
      await page.waitForFunction(() => window.launched.length === 1);
      assert.strictEqual(await page.evaluate(() => window.launched[0].exe), 'explorer.exe');
      assert.deepStrictEqual(await page.evaluate(() => window.launched[0].args), [unquoted]);
    }
    await boot();
    await page.evaluate(() => { window.failSpawn = true; });
    await search('notepad');
    await key(13);
    await page.getByText('启动失败：模拟进程错误').waitFor();
    assert.strictEqual(await page.evaluate(() => window.exited), 0);
    const failedRecord = await page.evaluate(() => window.saved.find(record => record.command === 'notepad'));
    assert(failedRecord.groups.includes('error'), 'Previously successful command must receive the error tag after a failed run');
    assert(failedRecord.groups.includes('办公'), 'Failure tagging must preserve existing tags');
    assert.strictEqual(failedRecord.time, records.find(record => record.command === 'notepad').time, 'Failed retry must not update last successful run time');
    assert(await page.locator('.row').filter({ hasText: 'notepad' }).locator('.chip').filter({ hasText: 'error' }).count());
    assert.strictEqual(await page.locator('.row').filter({ hasText: 'notepad' }).locator('.chip.error').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 227, 227)');
    assert.strictEqual(await page.locator('.row').filter({ hasText: 'notepad' }).locator('.chip.error').evaluate(el => getComputedStyle(el).color), 'rgb(180, 35, 24)');
    const errorClose = page.locator('.row').filter({ hasText: 'notepad' }).locator('.chip.error .ant-tag-close-icon');
    assert.strictEqual(await errorClose.evaluate(el => getComputedStyle(el).color), 'rgb(180, 35, 24)');
    const errorTagSize = await errorClose.evaluate(el => [el.getBoundingClientRect().width, el.getBoundingClientRect().height]);
    await errorClose.hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.chip.error .ant-tag-close-icon')).color === 'rgb(143, 29, 21)');
    assert.strictEqual(await errorClose.evaluate(el => getComputedStyle(el).color), 'rgb(143, 29, 21)');
    assert(['rgb(255, 201, 201)', 'rgba(255, 201, 201, 1)', 'rgba(255, 201, 201, 0.996)'].includes(await errorClose.evaluate(el => getComputedStyle(el).backgroundColor)));
    assert.deepStrictEqual(await errorClose.evaluate(el => [el.getBoundingClientRect().width, el.getBoundingClientRect().height]), errorTagSize, 'Error close hover must not resize the tag');
    assert(await page.evaluate(() => window.fileLogs.some(entry => entry.text.includes('plugin-stay'))));

    await boot();
    await page.evaluate(() => { window.failSpawn = true; });
    await search('D:\\Projects\\ClientApp');
    await key(13);
    await page.getByText('启动失败：模拟进程错误').waitFor();
    const failedPath = await page.evaluate(() => window.saved.find(record => record.command === 'D:\\Projects\\ClientApp'));
    assert(failedPath.groups.includes('error'), 'Previously successful path must receive the error tag when it no longer opens');
    assert(failedPath.groups.includes('项目文件夹') && failedPath.groups.includes('开发'));
    assert.strictEqual(failedPath.time, records.find(record => record.command === 'D:\\Projects\\ClientApp').time);

    await page.evaluate(() => { window.failSpawn = false; window.clock += 500; });
    await search('notepad');
    await key(13);
    await page.waitForFunction(() => window.exited === 1);
    const recoveredRecord = await page.evaluate(() => window.saved.find(record => record.command === 'notepad'));
    assert(!recoveredRecord.groups.includes('error'), 'Successful retry must clear the automatic error tag');
    assert(recoveredRecord.groups.includes('办公'), 'Successful retry must preserve user tags');
    assert.strictEqual(await page.locator('.tag[data-group="error"]').count(), 1, 'Error filter must remain while another record still has an error');
    await boot();
    await page.evaluate(() => { window.failSpawn = false; });
    await search('D:\\Projects\\ClientApp');
    await key(13);
    await page.waitForFunction(() => window.exited === 1);
    const recoveredPath = await page.evaluate(() => window.saved.find(record => record.command === 'D:\\Projects\\ClientApp'));
    assert(!recoveredPath.groups.includes('error'));
    assert.strictEqual(await page.locator('.tag[data-group="error"]').count(), 0, 'Clearing the last error must remove the automatic filter');

    await boot();
    await page.evaluate(() => { window.exitCode = 1; window.commandError = '不是内部或外部命令'; });
    await search('missing-command');
    await key(13);
    await page.getByText('启动失败：不是内部或外部命令').waitFor();
    assert.strictEqual(await page.evaluate(() => window.exited), 0);
    assert.strictEqual(await page.evaluate(() => window.saved.some(record => record.command === 'missing-command')), false, 'Failed commands must not be added to history');
    assert.strictEqual(await page.locator('.row').filter({ hasText: 'missing-command' }).count(), 0);
    await boot();
    await page.evaluate(() => { window.pendingCommand = true; });
    await search('long-command');
    await key(13);
    await page.waitForTimeout(2800);
    assert.strictEqual(await page.evaluate(() => window.exited), 0, 'Starting cmd is not successful command completion');
    assert.strictEqual(await page.getByText('启动失败：启动请求超时').count(), 0);

    await boot();
    const widths = () => page.locator('[data-group]').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().width));
    const before = await widths();
    await page.locator('.tag[data-group="开发"]').click();
    assert.deepStrictEqual(await widths(), before, 'Filter widths must stay stable');
    assert.strictEqual(await page.locator('.row').count(), 2);
    assert.strictEqual(await page.locator('.row.sel').getAttribute('data-id'), 'b', 'Changing a tag filter must select the first visible row');
    await page.locator('.tag[data-group=""]').click();
    assert.deepStrictEqual(await widths(), before);
    await page.locator('#tagAdd').click();
    await page.locator('#tagInput').fill('取消测试');
    await page.locator('#tagCancel').click();
    assert.strictEqual(await page.locator('#tagInput').count(), 0);
    await page.locator('#tagAdd').click();
    await page.locator('#tagInput').fill('空标签');
    await key(13);
    assert.strictEqual(await page.evaluate(() => window.launched.length), 0, 'Editor Enter must not launch commands');
    await page.locator('#tagInput').press('Enter');
    await page.locator('.tag[data-group="空标签"]').waitFor();
    assert(await page.evaluate(() => window.savedGroups?.includes('空标签')), 'Empty tags must be persisted');
    await page.locator('.tag[data-group="空标签"]').click({ button: 'right' });
    await menuClick('重命名标签');
    await page.locator('#tagInput').fill('新空标签');
    await page.locator('#tagConfirm').click();
    assert(await page.evaluate(() => window.savedGroups.includes('新空标签') && !window.savedGroups.includes('空标签')), 'Renaming empty tags must update persisted names');
    await page.locator('.tag[data-group="新空标签"]').click({ button: 'right' });
    await menuClick('删除标签');
    assert.strictEqual(await page.locator('.tag[data-group="新空标签"]').count(), 0);
    assert(!await page.evaluate(() => window.savedGroups.includes('新空标签')), 'Explicit deletion must remove persisted name');

    await page.locator('.tag[data-group=""]').click();
    await page.locator('.row[data-id="a"]').click({ button: 'right' });
    await page.getByRole('button', { name: '复制命令', exact: true }).click();
    assert.strictEqual(await page.evaluate(() => window.copied[0]), 'ipconfig /all');
    await page.getByRole('textbox', { name: '搜索标签' }).fill('测试标签');
    await page.getByRole('textbox', { name: '搜索标签' }).press('Enter');
    assert(await page.evaluate(() => window.saved.find(record => record.id === 'a').groups.includes('测试标签')));
    assert.strictEqual(await page.locator('.record-tag-panel').count(), 1, 'Creating a tag must keep panel open');
    await key(13);
    assert.strictEqual(await page.evaluate(() => window.launched.length), 0, 'Panel Enter must not execute a command');
    await key(27);
    await page.locator('.tag[data-group="测试标签"]').click({ button: 'right' });
    await menuClick('重命名标签');
    await page.locator('#tagInput').fill('重命名');
    await page.locator('#tagConfirm').click();
    assert(await page.evaluate(() => window.saved.find(record => record.id === 'a').groups.includes('重命名')));
    await page.locator('.tag[data-group="重命名"]').click({ button: 'right' });
    await menuClick('删除标签');
    assert(!await page.evaluate(() => window.saved.some(record => record.groups.includes('重命名'))));
    await page.locator('.row[data-id="a"] .ant-tag-close-icon').first().click();
    assert(!await page.evaluate(() => window.saved.find(record => record.id === 'a').groups.includes('IP查询')));
    assert.strictEqual(await page.locator('.tag[data-group="IP查询"] .n').innerText(), '0', 'Removing last association must retain the tag');
    await page.locator('.row[data-id="f"]').click({ button: 'right' });
    await page.getByRole('checkbox', { name: '开发', exact: true }).check();
    assert(await page.evaluate(() => window.saved.find(record => record.id === 'f').groups.includes('开发')));
    assert.strictEqual(await page.locator('.record-tag-panel').count(), 1);
    await page.getByRole('checkbox', { name: '办公', exact: true }).check();
    assert(await page.evaluate(() => window.saved.find(record => record.id === 'f').groups.includes('办公')));
    await page.screenshot({ path: path.join(output, 'record-tag-panel.png'), animations: 'disabled' });
    await page.getByRole('checkbox', { name: '开发', exact: true }).uncheck();
    assert(!await page.evaluate(() => window.saved.find(record => record.id === 'f').groups.includes('开发')));
    await page.getByRole('textbox', { name: '搜索标签' }).fill('办公');
    assert.strictEqual(await page.getByRole('checkbox').count(), 1);
    assert.strictEqual(await page.locator('.row').count(), 6, 'Tag search must not filter records');
    await page.getByRole('button', { name: '删除这条记录', exact: true }).click();
    assert(!await page.evaluate(() => window.saved.some(record => record.id === 'f')));

    await boot();
    await page.locator('.tag[data-group="办公"]').click();
    await page.locator('.row[data-id="d"]').click({ button: 'right' });
    await page.getByRole('checkbox', { name: '办公', exact: true }).uncheck();
    assert.strictEqual(await page.locator('.row').count(), 0);
    assert.strictEqual(await page.locator('.record-tag-panel').count(), 1, 'Removing active filter tag must not unmount panel');
    await page.getByRole('checkbox', { name: '开发', exact: true }).check();
    assert(await page.evaluate(() => window.saved.find(record => record.id === 'd').groups.includes('开发')));
    await key(27);

    await page.evaluate(() => sessionStorage.setItem('reload-fixture', '1'));
    await page.reload();
    await page.locator('.tag[data-group="办公"]').waitFor();
    assert.strictEqual(await page.locator('.tag[data-group="办公"] .n').innerText(), '0', 'Zero-count tag must survive reopening');
    await page.locator('.tag[data-group=""]').click();
    await page.locator('.row[data-id="b"]').click({ button: 'right' });
    await page.getByRole('button', { name: '删除这条记录', exact: true }).click();
    assert.strictEqual(await page.locator('.tag[data-group="项目文件夹"] .n').innerText(), '0', 'Deleting last record must retain its tags');
    await page.locator('#tagAdd').click();
    await page.locator('#tagInput').fill('持久空标签');
    await page.locator('#tagConfirm').click();
    await page.evaluate(() => sessionStorage.setItem('reload-fixture', '1'));
    await page.reload();
    await page.locator('.tag[data-group="持久空标签"]').waitFor();
    assert.strictEqual(await page.locator('.tag[data-group="持久空标签"] .n').innerText(), '0');
    await page.locator('.tag[data-group="持久空标签"]').click({ button: 'right' });
    await menuClick('删除标签');
    await page.evaluate(() => sessionStorage.setItem('reload-fixture', '1'));
    await page.reload();
    await page.locator('.row').first().waitFor();
    assert.strictEqual(await page.locator('.tag[data-group="持久空标签"]').count(), 0, 'Deleted tag must not return after reopening');

    await boot();
    await page.evaluate(() => {
      window.saved[0].groups = Array.from({ length: 40 }, (_, i) => `标签-${i}`);
      window.ready();
    });
    for (const width of [800, 375]) {
      await page.setViewportSize({ width, height: 570 });
      await page.locator('.row[data-id="a"]').click({ button: 'right', position: { x: width - 40, y: 40 } });
      await page.getByRole('textbox', { name: '搜索标签' }).waitFor();
      await page.locator('.panel-tags .rc-virtual-list-holder').evaluate(el => { el.scrollTop = el.scrollHeight; });
      const panelLayout = await page.locator('.record-tag-panel').evaluate(el => {
        const panel = el.getBoundingClientRect(), list = el.querySelector('.rc-virtual-list-holder'), search = el.querySelector('.panel-search').getBoundingClientRect(), footer = el.querySelector('.panel-footer').getBoundingClientRect();
        return { fits: panel.left >= 0 && panel.right <= innerWidth && panel.top >= 0 && panel.bottom <= innerHeight,
          scrolls: list.scrollHeight > list.clientHeight, fixed: search.bottom <= list.getBoundingClientRect().top && footer.top >= list.getBoundingClientRect().bottom };
      });
      assert(panelLayout.fits && panelLayout.scrolls && panelLayout.fixed, 'Only tag list should scroll within viewport');
      await page.screenshot({ path: path.join(output, `record-tag-panel-many-${width}.png`), animations: 'disabled' });
      await key(27);
      await page.locator('.row[data-id="a"]').evaluate(el => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: innerWidth - 8, clientY: innerHeight - 8 })));
      await page.getByRole('textbox', { name: '搜索标签' }).waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('.record-panel-popover')].some(el => getComputedStyle(el).opacity === '1'));
      await page.screenshot({ path: path.join(output, `panel-bottom-${width}.png`), animations: 'disabled' });
      assert(await page.locator('.record-tag-panel').evaluate(el => {
        const box = el.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth;
      }), 'Panel opened at bottom-right must be fully visible');
      await key(27);
    }
    await page.setViewportSize({ width: 800, height: 570 });

    await boot();
    await page.evaluate(() => { window.failSpawn = true; });
    await search('notepad');
    await key(13);
    await page.getByText('启动失败：模拟进程错误').waitFor();
    await boot();
    await page.evaluate(() => { window.throwSpawn = true; });
    await key(13);
    await page.getByText('启动失败：模拟启动失败').waitFor();
    await boot();
    await page.evaluate(() => { window.require = undefined; });
    await key(13);
    await page.getByText('启动失败：页面没有 child_process，无法执行命令').waitFor();

    for (const width of [1200, 800, 560, 375]) {
      await boot();
      await page.setViewportSize({ width, height: 570 });
      await page.screenshot({ path: path.join(output, `list-${width}.png`) });
      const layout = await page.locator('.row').evaluateAll(elements => elements.map(row => {
        const boxes = ['.ico', '.cmd', '.chips', '.time'].map(selector => row.querySelector(selector).getBoundingClientRect());
        return { height: row.getBoundingClientRect().height, commandWidth: boxes[1].width, overlaps: boxes.some((box, i) => i && box.left < boxes[i - 1].right - 1) };
      }));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert(await page.locator('.list').evaluate(el => getComputedStyle(el).scrollbarWidth === 'thin'));
      layout.forEach(row => { assert.strictEqual(row.height, 56); assert(row.commandWidth >= 75); assert(!row.overlaps); });
      const chip = page.locator('.chip').first();
      await chip.hover();
      assert(await chip.evaluate(el => el.querySelector('.chip-name').getBoundingClientRect().right <= el.querySelector('.ant-tag-close-icon').getBoundingClientRect().left));
      const chipWidth = await chip.evaluate(el => el.getBoundingClientRect().width);
      const close = chip.locator('.ant-tag-close-icon');
      await close.hover();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.chip .ant-tag-close-icon')).color === 'rgb(224, 32, 32)');
      await page.waitForFunction(() => ['rgb(255, 225, 225)', 'rgba(255, 225, 225, 1)'].includes(getComputedStyle(document.querySelector('.chip .ant-tag-close-icon')).backgroundColor));
      assert.strictEqual(await chip.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(220, 234, 255)');
      assert(await close.evaluate(el => {
        const box = el.getBoundingClientRect(), icon = el.querySelector('svg').getBoundingClientRect();
        return box.width === 18 && box.height === 18 &&
          Math.abs((box.left + box.right - icon.left - icon.right) / 2) < 0.5 &&
          Math.abs((box.top + box.bottom - icon.top - icon.bottom) / 2) < 0.5;
      }), 'Close glyph must be centered in its 18px square');
      assert.strictEqual(await chip.evaluate(el => el.getBoundingClientRect().width), chipWidth, 'Close hover must not resize tags');
      await page.screenshot({ path: path.join(output, `tag-close-hover-${width}.png`) });
      await page.locator('#tagAdd').click();
      await page.locator('#tagInput').fill('未保存标签');
      await page.screenshot({ path: path.join(output, `editor-${width}.png`) });
      await page.locator('#tagInput').press('Escape');
      assert.strictEqual(await page.locator('#tagInput').count(), 0);
      console.log(`PASS ${width}px: fixed rows, no overlaps, tags, editor and screenshot`);
    }
    await page.evaluate(() => {
      window.saved = Array.from({ length: 760 }, (_, i) => ({ id: `r${i}`, command: `cmd-${i}`, time: i, kind: 'command', groups: i < 260 ? ['保留'] : [] }));
      window.ready();
    });
    assert(await page.locator('.row').count() < 20, 'Virtual list must render only a small window');
    await page.locator('#list').evaluate(el => { el.scrollTop = 5600; });
    await search('cmd-0');
    assert(await page.locator('.row').count() > 0, 'Searching after scrolling must reset the viewport');
    await search('new-command');
    await page.evaluate(() => { window.clock += 500; });
    await key(13);
    await page.waitForFunction(() => window.exited === 1);
    assert.strictEqual(await page.evaluate(() => window.saved.length), 760);
    assert.strictEqual(await page.evaluate(() => window.saved.filter(record => record.groups.length).length), 260);
    await page.evaluate(() => { window.saved = []; window.ready(); });
    await page.locator('.empty').waitFor();
    assert.strictEqual(await page.locator('.row.sel').count(), 0);
    await key(40);
    assert.strictEqual(await page.locator('.row').count(), 0);

    for (const scale of [1, 1.5]) {
      const host = await browser.newPage({ viewport: { width: 900, height: 640 }, deviceScaleFactor: scale });
      host.on('pageerror', error => errors.push(error.message));
      await host.route('http://rubick.test/**', route => {
        const file = new URL(route.request().url()).pathname.slice(1);
        if (!['tests/fixtures/rubick-host.html', 'public/index.html', 'package.json'].includes(file)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ contentType: file.endsWith('.json') ? 'application/json' : 'text/html', body: fs.readFileSync(path.join(ROOT, file)) });
      });
      await host.goto('http://rubick.test/tests/fixtures/rubick-host.html');
      const plugin = host.frameLocator('#plugin');
      await plugin.locator('.row.sel').waitFor();
      assert.strictEqual(await plugin.locator('.row.sel').getAttribute('data-id'), 'path');
      await host.screenshot({ path: path.join(output, `rubick-host-${scale === 1 ? 900 : 1376}.png`) });
      await host.locator('#search').fill('notepad');
      await host.locator('#search').press('Enter');
      await host.waitForFunction(() => window.launched.includes('notepad'));
      assert.strictEqual(await host.locator('#search').inputValue(), '');
      await host.close();
    }
    assert.deepStrictEqual(errors, []);
    console.log('PASS offline file load, host forwarding, default selection, search, execution failures, revision, tagging, clipboard, retention and virtualization');
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png') });
    console.error(await page.locator('body').innerText());
    console.error(errors);
    throw error;
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
