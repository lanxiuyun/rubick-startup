// 一次跑完全部自检：npm test
const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  ['../tools/lint-page.js', '页面静态检查（语法/残留引用/关键元素）'],
  ['static.test.js', '清单 / 入口 / 无桥接残留 / 安装链路'],
  ['ui.test.js', '页面端到端链路（最小 DOM + child_process 桩）']
];

let failed = 0;
const results = [];

for (const [file, title] of SUITES) {
  console.log(`\n########## ${title}  (${file}) ##########`);
  const run = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  const okRun = run.status === 0;
  if (!okRun) failed++;
  results.push({ file, ok: okRun });
}

console.log('\n========== 汇总 ==========');
for (const item of results) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.file}`);
}
if (failed) {
  console.error(`\n${failed} 个测试套件失败。`);
  process.exitCode = 1;
} else {
  console.log('\n全部套件通过。');
}
