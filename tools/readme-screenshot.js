const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const stamp = new Date(2026, 9, 14, 10, 30).getTime();
const records = [
  { command: 'D:\\Demo\\AuroraApp', kind: 'path', groups: ['项目', '开发'] },
  { command: 'notepad', kind: 'command', groups: ['办公'] },
  { command: 'ipconfig /all', kind: 'command', groups: ['网络', '系统'] },
  { command: 'D:\\Demo\\SampleAssets', kind: 'path', groups: ['素材'] },
  { command: 'python demo.py', kind: 'command', groups: ['开发'] },
  { command: 'calc.exe', kind: 'command', groups: ['办公'] },
  { command: 'explorer', kind: 'command', groups: ['系统'] },
  { command: 'git status', kind: 'command', groups: ['开发'] }
].map((record, index) => ({ ...record, id: `demo-${index}`, time: stamp - index * 60000 }));

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 860, height: 630 }, deviceScaleFactor: 2 });
    await page.addInitScript(seed => { window.e2eRecords = seed; }, records);
    await page.route('http://rubick.test/**', route => {
      const file = new URL(route.request().url()).pathname.slice(1);
      if (!['tests/fixtures/rubick-host.html', 'public/index.html', 'package.json'].includes(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: file.endsWith('.json') ? 'application/json' : 'text/html', body: fs.readFileSync(path.join(root, file)) });
    });
    await page.goto('http://rubick.test/tests/fixtures/rubick-host.html');
    const plugin = page.frameLocator('#plugin');
    await plugin.locator('.row.sel').waitFor();
    await plugin.locator('.row[data-id="demo-0"]').click({ button: 'right' });
    await plugin.getByRole('textbox', { name: '搜索标签' }).waitFor();
    await page.waitForTimeout(350);
    await page.locator('.window').screenshot({ path: path.join(root, 'docs/images/rubick-startup.png'), animations: 'disabled' });
    console.log('README screenshot generated from fictional demo records.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
