// 隐私体检：扫描仓库里每个文件里的绝对路径、用户名、邮箱、凭证特征
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || '.';
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(full);
  }
})(ROOT);

const patterns = [
  ['Windows 用户目录', /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+/g],
  ['本机项目路径', /C:[\\/]+work_sapce|D:[\\/]+rubick/g],
  ['Unix home 路径', /\/Users\/[A-Za-z0-9._-]+/g],
  ['邮箱', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  ['疑似密钥', /(ghp_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|sk-[A-Za-z0-9]{10,})/g],
  ['中文姓名/作者字段', /"author"\s*:\s*"([^"]+)"/g]
];

let total = 0;
for (const file of files) {
  let src;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch (error) {
    continue;
  }
  for (const [label, re] of patterns) {
    const matches = src.match(re);
    if (!matches) continue;
    total += matches.length;
    console.log(`[${label}] ${path.relative(ROOT, file)} × ${matches.length}`);
    for (const value of [...new Set(matches)].slice(0, 8)) console.log(`      ${value}`);
  }
}
console.log(total ? `\n共 ${total} 处需要处理` : '\n未发现绝对路径 / 邮箱 / 密钥');
