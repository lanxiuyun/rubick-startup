const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const output = path.join(__dirname, '..', '.visual-qa');
  fs.mkdirSync(output, { recursive: true });
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const records = [
    { id: 'a', command: 'ipconfig /all', kind: 'command', groups: ['IP查询', '网络', '系统'] },
    { id: 'b', command: 'D:\\Projects\\ClientApp', kind: 'path', groups: ['项目文件夹', '开发'] },
    { id: 'c', command: 'calc', kind: 'command', groups: ['系统', '实用工具'] },
    { id: 'd', command: 'notepad', kind: 'command', groups: ['办公'] },
    { id: 'e', command: 'https://example.com/docs/reference/integration/getting-started', kind: 'url', groups: ['开发', '文档'] },
    { id: 'f', command: 'powershell -NoProfile -Command "Get-Process | Sort-Object CPU -Descending"', kind: 'command', groups: [] }
  ].map((r, i) => ({ ...r, time: Date.now() - i * 60000 }));
  try {
    for (const width of [1376, 900]) {
      const scale = width === 1376 ? 1.5 : 1;
      const page = await browser.newPage({ viewport: { width: Math.round(width / scale), height: Math.round(940 / scale) }, deviceScaleFactor: scale });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://rubick.test/**', async route => {
        const pathname = new URL(route.request().url()).pathname;
        const files = {
          '/tests/fixtures/rubick-host.html': ['tests/fixtures/rubick-host.html', 'text/html'],
          '/public/index.html': ['public/index.html', 'text/html'],
          '/package.json': ['package.json', 'application/json']
        };
        const file = files[pathname];
        if (!file) return route.fulfill({ status: 404, body: '' });
        await route.fulfill({ contentType: file[1], body: fs.readFileSync(path.join(__dirname, '..', file[0])) });
      });
      await page.goto('http://rubick.test/tests/fixtures/rubick-host.html');
      const plugin = page.frameLocator('#plugin');
      await plugin.locator('.row').first().waitFor();
      await page.locator('#search').focus();
      await page.keyboard.press('ArrowDown');
      assert.strictEqual(await plugin.locator('.row.sel').count(), 1);
      await page.screenshot({ path: path.join(output, `rubick-host-${width}.png`) });
      await page.locator('#search').fill('notepad');
      assert.strictEqual(await plugin.locator('.row').count(), 1);
      await page.locator('#search').press('Enter');
      await page.waitForFunction(() => window.launched.includes('notepad'));
      assert.strictEqual(await page.locator('#search').inputValue(), '');
      await plugin.locator('#tagAdd').click();
      await plugin.locator('#tagInput').fill('取消测试');
      await plugin.locator('#tagCancel').click();
      assert.strictEqual(await plugin.locator('#tagInput').count(), 0);
      assert.deepStrictEqual(errors, []);
      console.log(`PASS Rubick host ${width}px: complete window, forwarded keys, search, safe execution, cancel`);
      await page.close();
    }
    for (const width of [1200, 800, 560, 375]) {
      const page = await browser.newPage({ viewport: { width, height: 570 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent('<html><body></body></html>');
      await page.evaluate(seed => {
        window.rubick = {
          db: { get: () => ({ records: seed }), put: doc => { window.saved = doc; } },
          setSubInput: cb => { window.search = cb; },
          setSubInputValue: () => {}, onPluginReady: () => {}, setExpendHeight: () => {}
        };
      }, records);
      await page.setContent(html);
      await page.locator('.row').first().waitFor();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.screenshot({ path: path.join(output, `list-${width}.png`) });
      const layout = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.row')];
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          rows: rows.map(row => {
            const boxes = ['.ico', '.cmd', '.chips', '.time'].map(sel => row.querySelector(sel).getBoundingClientRect());
            return { height: row.getBoundingClientRect().height, commandWidth: boxes[1].width,
              overlaps: boxes.some((box, i) => i && box.left < boxes[i - 1].right - 1) };
          })
        };
      });
      assert(!layout.overflow, `Horizontal overflow at ${width}`);
      layout.rows.forEach(row => {
        assert.strictEqual(row.height, 56);
        assert(row.commandWidth >= 75, `Command squeezed at ${width}: ${row.commandWidth}`);
        assert(!row.overlaps, `Overlapping columns at ${width}`);
      });
      await page.locator('#tagAdd').click();
      await page.locator('#tagInput').fill('未保存标签');
      await page.screenshot({ path: path.join(output, `editor-${width}.png`) });
      await page.locator('#tagCancel').click();
      assert.strictEqual(await page.locator('#tagInput').count(), 0);
      await page.locator('.row').first().click({ button: 'right' });
      await page.locator('[data-act="newgroup"]').click();
      await page.locator('#newgroup').fill('测试标签');
      await page.locator('#newgroup').press('Enter');
      assert(await page.evaluate(() => window.saved.records.some(r => r.groups.includes('测试标签'))));
      await page.evaluate(() => window.search({ text: 'notepad' }));
      assert.strictEqual(await page.locator('.row').count(), 1);
      await page.evaluate(() => window.search({ text: '' }));
      await page.locator('#list').evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.locator('.row').last().waitFor();
      if (width === 800) {
        await page.evaluate(() => {
          window.rubick.db.get = () => ({ records: [
            { id: 'path', command: 'D:\\Projects', kind: 'path', time: Date.now(), groups: [] },
            { id: 'pad', command: 'notepad', kind: 'command', time: Date.now() - 60000, groups: ['123'] }
          ] });
        });
        await page.setContent(html);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.screenshot({ path: path.join(output, 'two-records-800.png') });
      }
      assert.deepStrictEqual(errors, []);
      console.log(`PASS ${width}px: screenshot, layout, cancel, record tagging`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
