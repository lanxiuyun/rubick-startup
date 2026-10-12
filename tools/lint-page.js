// 页面内联脚本的静态检查：语法 + 已删元素的残留引用 + 关键声明/元素齐全
//
// 之所以单独做这个：我在这轮手改中两次把全角括号写进 JS、一次留下重复声明、
// 一次引用已删除的元素 —— 这些都不是测试能第一时间报出来的低级错误。
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'public', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

let bad = 0;
const fail = msg => { console.log('  FAIL ' + msg); bad++; };
const pass = msg => console.log('  OK   ' + msg);

// 1. 语法
try {
  new Function(code);
  pass('内联脚本语法通过');
} catch (error) {
  fail('语法错误：' + error.message);
}

// 2. 被删掉的输入框/按钮不该再被引用（DOM 里不能有，脚本里不能取）
for (const id of ['query', 'run']) {
  if (html.includes(`id="${id}"`)) fail(`DOM 里仍有已删除的 id="${id}"`);
  if (code.includes(`$('${id}')`)) fail(`脚本仍在引用已删除的元素 $('${id}')`);
}
if (!bad) pass('已删除的输入框与按钮无残留引用');

// 3. 常见低级错误：中文字符混进 JS 代码（注释里用中文是正常的，跳过注释行）
const lines = code.split('\n');
let cjkOutsideString = 0;
lines.forEach((line, i) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
  // 去掉字符串内容与行尾注释，剩下的才应该是纯 ASCII 代码
  const stripped = line
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""')
    .replace(/`[^`]*`/g, '``')
    .replace(/\/\/.*$/, '');
  if (/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(stripped)) {
    fail(`第 ${i + 1} 行在代码位置出现中文或全角标点：${stripped.trim().slice(0, 90)}`);
    cjkOutsideString++;
  }
});
if (!cjkOutsideString) pass('代码位置没有中文或全角标点混入');

// 4. 关键声明只应出现一次
for (const [label, re] of [['records 状态', /let records=/g], ['subInputReady', /subInputReady\s*=\s*false/g], ['currentCommand', /currentCommand\s*=\s*''/g]]) {
  const n = (code.match(re) || []).length;
  if (n === 1) pass(`${label} 声明恰好一次`);
  else fail(`${label} 声明出现 ${n} 次，应为 1`);
}

// 5. 关键元素在 DOM 里必须各出现一次
const missing = [];
for (const id of ['tags', 'list', 'spacer', 'menu', 'toast']) {
  const n = html.split(`id="${id}"`).length - 1;
  if (n !== 1) missing.push(`${id}×${n}`);
}
if (!missing.length) pass('关键元素齐全（tags/list/spacer/menu/toast）');
else fail(`元素 id 数量异常：${missing.join(', ')}`);

// 5a. 顶栏必须只有一行：标签 + ＋ 添加
if (!/<div class="bar">/.test(html)) fail('缺少单行顶栏 .bar');
if (/class="head"/.test(html)) fail('头部块又回来了（应该只有一个 .bar）');
if (!/id="tagAdd"|＋ 标签/.test(html) && !/tagAdd/.test(html)) fail('.bar 里缺少「＋ 标签」添加按钮');
if (!/\.bar\{[^}]*display:flex/.test(html)) fail('.bar 不是 flex 单行布局');
if (html.includes('id="status"') || code.includes("$('status')")) fail('已移除的环境状态 UI 仍有引用');
else pass('顶栏单行：标签在左 / ＋ 添加，无环境状态 UI');

// 5b. 已砍掉的 UI 不该复活
for (const dead of ['id="echo"', 'id="keyhint"', 'id="count"', 'id="sectionTitle"', 'data-star', 'brandLogo']) {
  if (html.includes(dead)) fail(`已砍掉的界面元素又出现了：${dead}`);
}
pass('回显块/按键提示/条数计数/☆收藏/头部Logo 均未复活');

// 5c. 虚拟滚动的两个前提：容器可滚动 + 行高固定
if (/\.list\{[^}]*overflow-y:auto/.test(html)) pass('列表容器可滚动（虚拟滚动前提）');
else fail('列表容器没有 overflow-y:auto，虚拟滚动会失效');
if (/const ROW_H=\d+/.test(html)) pass('行高是常量（虚拟滚动靠它算窗口）');
else fail('没有固定行高常量，虚拟滚动的窗口计算会错位');
if (/\.chip\.more/.test(html)) pass('标签超出时有 +N 折叠（保证行高不被标签数撑破）');
else fail('标签没有折叠机制，行高会随标签数变化，虚拟滚动会错位');

// 6. 输入层三条通道都还在
for (const [label, needle] of [
  ['setSubInput 接管搜索框', 'setSubInput('],
  ['keydown 收转发按键', "addEventListener('keydown'"],
  ['执行后清空搜索框', 'setSubInputValue']
]) {
  if (code.includes(needle)) pass(label);
  else fail(`输入层缺少：${label}`);
}

console.log(bad ? `\n静态检查未通过：${bad} 处` : '\n静态检查全部通过');process.exitCode = bad ? 1 : 0;
