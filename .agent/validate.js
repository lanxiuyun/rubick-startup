// 校验 .agent/ 知识库的结构与索引一致性
// 用法: node .agent/validate.js
//
// 检查项（对应 knowledge-precipitation skill 的第 5 步）：
//   1. manifest 里引用的每个文件都真实存在
//   2. 每个 features / architecture / skills 目录下都有 README.md
//   3. 没有未被 manifest 引用的孤儿文档
//   4. 除 README.md 外的文件名必须是描述性长名字（不是 fix.md / notes.md 这类）
//   5. current.next 非空
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AGENT = path.join(ROOT, '.agent');
const MANIFEST = path.join(AGENT, 'manifest.yaml');

let bad = 0;
const fail = m => { console.log('  FAIL ' + m); bad++; };
const pass = m => console.log('  OK   ' + m);

// ── 解析 manifest（只认我们用的这个子集，不引第三方 yaml 库）──
const manifestText = fs.readFileSync(MANIFEST, 'utf8');
const referenced = new Set();
for (const m of manifestText.matchAll(/^\s*-\s*(\.agent\/[^\s#]+)\s*$/gm)) referenced.add(m[1].replace(/\\/g, '/'));
for (const m of manifestText.matchAll(/^\s{4}docs:\s*$/gm)) { /* docs 已由上一条捕获 */ }

console.log('== 1. manifest 引用的文件是否存在 ==');
for (const rel of referenced) {
  if (fs.existsSync(path.join(ROOT, rel))) pass(rel);
  else fail(`manifest 引用了不存在的文件：${rel}`);
}

console.log('\n== 2. 各领域目录是否有 README.md ==');
for (const domain of ['features', 'architecture', 'skills']) {
  const dir = path.join(AGENT, domain);
  if (!fs.existsSync(dir)) { fail(`缺少目录 ${domain}/`); continue; }
  for (const name of fs.readdirSync(dir)) {
    const entry = path.join(dir, name, 'README.md');
    if (fs.existsSync(entry)) pass(`${domain}/${name}/README.md`);
    else fail(`${domain}/${name}/ 下没有 README.md`);
  }
}

console.log('\n== 3. 未被 manifest 引用的孤儿文档 ==');
const allDocs = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith('.md')) allDocs.push(path.relative(ROOT, full).replace(/\\/g, '/'));
  }
})(AGENT);
const orphans = allDocs.filter(d => !referenced.has(d));
if (!orphans.length) pass('没有孤儿文档');
else orphans.forEach(o => fail(`孤儿文档（未进 manifest）：${o}`));

console.log('\n== 4. 文件名是否描述性（除 README.md）==');
const badNames = /^(notes|fix|dev-notes|impl|state|phase\d*|misc|tmp|temp|doc)\.md$/i;
for (const d of allDocs) {
  const base = path.basename(d);
  if (base === 'README.md') continue;
  // 描述性判据：够长、且包含连字符（英文 slug）或有明确中文词
  const descriptive = base.length >= 24 && /-/.test(base);
  if (badNames.test(base) || !descriptive) fail(`${d} 名字不够描述性（应能一眼看懂内容）`);
}
if (!allDocs.some(d => badNames.test(path.basename(d)))) pass('没有 notes/fix/state 这类模糊命名');

console.log('\n== 5. current.next 非空 ==');
const next = /^\s*next:\s*(.+)$/m.exec(manifestText);
if (next && next[1].trim()) pass(`next = ${next[1].trim().slice(0, 60)}…`);
else fail('manifest 的 current.next 为空');

console.log(bad ? `\n知识库校验未通过：${bad} 处` : '\n知识库校验通过');
process.exitCode = bad ? 1 : 0;
