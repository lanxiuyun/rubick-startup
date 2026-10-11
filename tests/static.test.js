// 清单 / 入口 / 安装链路的静态校验。
// 单插件版：只有一个 UI 插件，页面自己 require('child_process') 执行。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = p => fs.existsSync(path.join(ROOT, p));
const json = p => JSON.parse(read(p));

let pass = 0;
const ok = name => { pass++; console.log('  PASS  ' + name); };

console.log('== 1. 插件清单 ==');
const ui = json('package.json');
assert.strictEqual(ui.name, 'rubick-startup');
assert.strictEqual(ui.pluginType, 'ui', 'pluginType 必须是 ui');
assert.strictEqual(ui.main, 'public/index.html');
assert(ui.main && exists(ui.main), `main 指向的文件不存在：${ui.main}`);
assert(ui.preload === undefined, '单插件版不该再有 preload 字段（页面自己 require，不依赖 preload）');
assert(Array.isArray(ui.features) && ui.features.length, 'features 缺失（Rubick 靠 cmds 建索引，没有就搜不到）');
const cmds = ui.features.flatMap(f => f.cmds || []);
for (const keyword of ['运行', '启动', 'start', 'fav']) {
  assert(cmds.includes(keyword), `搜索关键词缺少 ${keyword}`);
}
// 官方文档：logo 必须是 http/https 在线地址，不支持本地 logo
assert(/^data:image\/svg\+xml;base64,/.test(ui.logo), `logo 必须是 data URI 或在线地址，实际：${String(ui.logo).slice(0, 40)}`);
assert(!exists('public/logo.svg'), '本地 logo.svg 应已删除（Rubick 不支持本地 logo 文件）');
assert(!exists('public/package.json'), 'public/ 下不该有 package.json：Rubick 只读根清单，留着会误导安装');
ok(`pluginType=ui, main=${ui.main}, 无 preload, cmds=[${cmds.join(', ')}], logo=data URI`);

console.log('== 2. 桥接层已彻底移除 ==');
assert(!exists('bridge'), 'bridge/ 目录应该已经删掉');
assert(!exists('public/preload.js'), 'public/preload.js 应该已经删掉');
// 运行时代码里不能有任何桥接引用
for (const file of ['package.json', 'public/index.html']) {
  const src = read(file);
  assert(!/rubick-startup-bridge/.test(src), `${file} 里还有桥接插件的残留引用`);
  assert(!/bridge-check|bridge-status|rubick-startup:run/.test(src), `${file} 里还有桥接 IPC 的残留`);
}
// 安装器唯一允许提到桥接的地方：为了把旧残留清理掉
const installer = read('tools/install.js');
assert(/LEGACY/.test(installer) && /rubick-startup-bridge/.test(installer), '安装器应保留旧桥接的清理名单');
ok('bridge/ 与 preload.js 已删除；只有安装器的清理名单还提到旧桥接');

console.log('== 3. 页面结构与关键行为 ==');
const html = read('public/index.html');
assert(/<script>[\s\S]*<\/script>/.test(html), 'index.html 缺少内联脚本');
assert(html.includes('setExpendHeight'), '页面未按插件高度展开');
assert(html.includes('id="diag"'), '页面缺少诊断串（排查时要靠它）');
assert(html.includes("require('child_process')"), '页面必须直接 require(child_process) —— 这是单插件版的核心');
assert(!/ipcRenderer\.send\('rubick-startup:run'/.test(html), '页面不该再往桥接发运行请求');
assert(html.includes('appendFileSync'), '页面应把运行日志写到文件，便于离线排查');
assert(html.includes('cmd.exe'), '执行必须显式走 cmd.exe');
assert(html.includes('detached'), 'spawn 应 detached，避免被父进程牵连');
assert(html.includes('unref'), 'spawn 后应 unref，否则 Rubick 退出会被子进程拖住');
assert(html.includes('可以运行') && html.includes('无法执行命令'), '页面缺少运行环境状态文案');
ok('页面直连 child_process，含状态/诊断/日志/状态文案');

console.log('== 4. JS 语法 ==');
for (const file of ['tools/install.js']) {
  execFileSync(process.execPath, ['--check', path.join(ROOT, file)], { stdio: 'pipe' });
}
execFileSync(process.execPath, ['-e', `new Function(require('fs').readFileSync(${JSON.stringify(path.join(ROOT, 'public/index.html'))},'utf8').match(/<script>([\\s\\S]*?)<\\/script>/)[1])`], { stdio: 'pipe' });
ok('tools/install.js 与页面内联脚本语法通过');

console.log('== 5. 安装器逻辑自校验 ==');
// 只校验安装器自己的逻辑（清单是否合规），不依赖"已经装过"。
// 是否真的装进 Rubick 用 `npm run check:rubick` 查，避免 npm test 依赖机器状态。
const installSrc = read('tools/install.js');
assert(installSrc.includes('rubick-local-plugin.json'), '安装器必须写 Rubick 的插件注册表（npm link 不做这件事）');
assert(installSrc.includes('junction'), '安装器应优先用 junction（Windows 免管理员权限）');
assert(installSrc.includes('LEGACY'), '安装器应清理旧的系统插件残留');
assert(installSrc.includes('features'), '安装器应校验 features（否则插件搜不到）');
ok('安装器含注册表写入 / junction / 旧残留清理 / features 校验');

console.log('\n全部通过：' + pass + ' 项');
