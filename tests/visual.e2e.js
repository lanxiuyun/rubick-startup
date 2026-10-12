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
  window.saved = seed;
  window.launched = [];
  window.copied = [];
  window.clock = Date.now();
  window.__rubickStartupNow = () => window.clock;
  window.rubick = {
    db: { get: () => ({ _rev: '1-test', records: window.saved }), put: doc => { window.saved = doc.records; window.revision = doc._rev; } },
    setSubInput: callback => { window.search = callback; },
    setSubInputValue: value => { window.cleared = value; window.search({ text: value }); },
    onPluginReady: callback => { window.ready = callback; }, setExpendHeight: () => {}
  };
  window.require = name => {
    if (name === 'electron') return { clipboard: { writeText: text => window.copied.push(text) } };
    if (name !== 'child_process') throw new Error('Isolated browser test');
    return { spawn: (exe, args, options) => {
      if (window.throwSpawn) throw new Error('模拟启动失败');
      window.launched.push({ exe, args, options });
      const child = { once: (type, callback) => {
        if (type === (window.failSpawn ? 'error' : 'spawn')) setTimeout(() => callback(new Error('模拟进程错误')), 0);
        return child;
      }, unref: () => { window.unreffed = true; } };
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
    await key(13);
    await page.waitForFunction(() => window.launched.length === 1);
    assert.strictEqual(await page.evaluate(() => window.launched[0].args[3]), 'ipconfig /all');
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
    assert.strictEqual(await page.locator('.row.sel').count(), 0);
    await page.evaluate(() => window.ready());
    assert.strictEqual(await page.locator('.row.sel').count(), 0);
    await page.evaluate(() => { window.clock += 500; });
    await key(13);
    await page.waitForFunction(() => window.launched.length === 2);
    assert.strictEqual(await page.evaluate(() => window.launched[1].args[3]), 'notepad');
    assert.strictEqual(await page.evaluate(() => window.revision), '1-test');

    await boot();
    const widths = () => page.locator('[data-group]').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().width));
    const before = await widths();
    await page.locator('.tag[data-group="开发"]').click();
    assert.deepStrictEqual(await widths(), before, 'Filter widths must stay stable');
    assert.strictEqual(await page.locator('.row').count(), 2);
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
    await page.locator('.tag[data-group="空标签"]').click({ button: 'right' });
    await menuClick('重命名标签');
    await page.locator('#tagInput').fill('新空标签');
    await page.locator('#tagConfirm').click();
    await page.locator('.tag[data-group="新空标签"]').click({ button: 'right' });
    await menuClick('删除标签');
    assert.strictEqual(await page.locator('.tag[data-group="新空标签"]').count(), 0);

    await page.locator('.tag[data-group=""]').click();
    await page.locator('.row[data-id="a"]').click({ button: 'right' });
    await menuClick('复制命令');
    assert.strictEqual(await page.evaluate(() => window.copied[0]), 'ipconfig /all');
    await page.locator('.row[data-id="a"]').click({ button: 'right' });
    await menuClick('新建标签并加入…');
    await page.locator('#tagInput').fill('测试标签');
    await page.locator('#tagInput').press('Enter');
    assert(await page.evaluate(() => window.saved.find(record => record.id === 'a').groups.includes('测试标签')));
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
    await page.locator('.row[data-id="f"]').click({ button: 'right' });
    await page.getByRole('menuitem').filter({ hasText: /^加入已有标签$/ }).hover();
    await menuClick('开发');
    assert(await page.evaluate(() => window.saved.find(record => record.id === 'f').groups.includes('开发')));
    await page.locator('.row[data-id="f"]').click({ button: 'right' });
    await page.getByRole('menuitem').filter({ hasText: /^移出标签$/ }).hover();
    await menuClick('开发');
    assert(!await page.evaluate(() => window.saved.find(record => record.id === 'f').groups.includes('开发')));
    await page.locator('.row[data-id="f"]').click({ button: 'right' });
    await menuClick('删除这条记录');
    assert(!await page.evaluate(() => window.saved.some(record => record.id === 'f')));

    await boot();
    await page.evaluate(() => { window.failSpawn = true; });
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
      layout.forEach(row => { assert.strictEqual(row.height, 56); assert(row.commandWidth >= 75); assert(!row.overlaps); });
      const chip = page.locator('.chip').first();
      await chip.hover();
      assert(await chip.evaluate(el => el.querySelector('.chip-name').getBoundingClientRect().right <= el.querySelector('.ant-tag-close-icon').getBoundingClientRect().left));
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
