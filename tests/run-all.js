// 一次跑完全部自检：npm test
const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  ['../tools/lint-page.js', '页面静态检查（语法/残留引用/关键元素）'],
  ['../.agent/validate.js', '知识库索引一致性（.agent/）'],
  ['static.test.js', '清单 / 入口 / 无桥接残留 / 安装链路'],
  ['ui.test.js', '记录模型与键盘规则'],
  ['runtime.test.js', 'Windows 真实命令退出码与错误输出'],
  ['visual.e2e.js', 'React + Ant Design 真实浏览器交互与视觉回归']
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
