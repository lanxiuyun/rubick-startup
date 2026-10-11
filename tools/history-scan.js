// 检查 git 历史（提交信息 + 每个历史版本的文件内容）里有没有本机路径/姓名等隐私
const { execFileSync } = require('child_process');

const PATTERNS = [
  ['Windows 用户目录', /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+/g],
  ['本机项目路径', /C:[\\/]+work_sapce|D:[\\/]+rubick/g],
  ['作者字段', /"author"\s*:\s*"([^"]+)"/g]
];

function scan(label, text) {
  let found = 0;
  for (const [name, re] of PATTERNS) {
    const matches = [...text.matchAll(re)].map(m => m[0]);
    if (!matches.length) continue;
    const unique = [...new Set(matches)];
    // 过滤掉占位写法，只报真实取值
    const real = unique.filter(v => !/%|<|>|\$/.test(v));
    if (!real.length) continue;
    found += real.length;
    console.log(`[${name}] ${label}`);
    for (const value of real.slice(0, 10)) console.log(`      ${value}`);
  }
  return found;
}

const commits = execFileSync('git', ['log', '--all', '--format=%H'], { encoding: 'utf8' })
  .split('\n').filter(Boolean);

let total = 0;
for (const sha of commits) {
  const message = execFileSync('git', ['log', '-1', '--format=%s%n%b', sha], { encoding: 'utf8' });
  total += scan(`提交信息 ${sha.slice(0, 8)}`, message);

  const files = execFileSync('git', ['show', '--name-only', '--format=', sha], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
  for (const file of files) {
    let content = '';
    try {
      content = execFileSync('git', ['show', `${sha}:${file}`], { encoding: 'utf8' });
    } catch (error) {
      continue; // 该版本里这个文件不存在
    }
    total += scan(`${sha.slice(0, 8)}:${file}`, content);
  }
}

console.log(total ? `\n历史里共 ${total} 处隐私，需要重写历史` : '\ngit 历史干净（提交信息与各版本文件内容都无本机路径/姓名）');
