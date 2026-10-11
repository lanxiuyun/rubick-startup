#!/usr/bin/env node
/**
 * 启动收藏 · Rubick 安装器（单插件版）
 *
 * 只装一个 UI 插件。以前那个「系统插件桥接」已经删掉了 —— 真机实证插件页面
 * 自己能 require('child_process')，不需要中间层。
 *
 * 为什么必须用脚本而不是 npm link：
 * Rubick 的本地插件要同时满足两件事（反编译 app.asar 4.3.8 得到的加载逻辑）：
 *   1. 目录出现在 %APPDATA%\Rubick\rubick-plugins-new\node_modules\<name>
 *      （页面路径 = node_modules/<name>/<main>）
 *   2. 名字出现在同目录的 rubick-local-plugin.json 里
 *      （主进程 getLocalPlugins() 只读这个文件）
 * `npm link` 只做到第 1 件，跳过第 2 件，所以插件永远不在 Rubick 的名单里。
 *
 * 用法：
 *   node tools/install.js             安装 / 更新
 *   node tools/install.js --check     只体检，不改动
 *   node tools/install.js --uninstall 移除
 */

const fs = require('fs');
const path = require('path');

const PROJECT_DIR = path.resolve(__dirname, '..');
const PLUGIN = { name: 'rubick-startup', dir: PROJECT_DIR };
// 老版本留下的系统插件，安装/卸载时一并清掉，避免残留登记让 Rubick 每次启动都去 require
const LEGACY = ['rubick-startup-bridge'];
const APP_PLUGIN_DIR = 'rubick-plugins-new';

const APPDATA = process.env.APPDATA;
if (!APPDATA) {
  console.error('找不到 %APPDATA%，无法定位 Rubick 插件目录。');
  process.exit(1);
}
const PLUGIN_ROOT = path.join(APPDATA, 'Rubick', APP_PLUGIN_DIR);
const REGISTRY = path.join(PLUGIN_ROOT, 'rubick-local-plugin.json');
const MODULES = path.join(PLUGIN_ROOT, 'node_modules');

const arg = process.argv[2] || '';
const MODE = arg === '--uninstall' ? 'uninstall' : arg === '--check' ? 'check' : 'install';

function readManifest(label, dir = PROJECT_DIR) {
  const file = path.join(dir, 'package.json');
  if (!fs.existsSync(file)) throw new Error(`${label} 缺少 package.json：${file}`);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${label} 的 package.json 不是合法 JSON：${error.message}`);
  }
  for (const key of ['name', 'pluginName', 'description', 'version', 'main', 'pluginType']) {
    if (!manifest[key]) throw new Error(`${label} 的 package.json 缺少字段 ${key}`);
  }
  if (manifest.pluginType !== 'ui') throw new Error(`pluginType 应为 "ui"，实际是 ${manifest.pluginType}`);
  if (manifest.name !== PLUGIN.name) throw new Error(`name 应为 ${PLUGIN.name}，实际是 ${manifest.name}`);
  if (!Array.isArray(manifest.features) || !manifest.features.length) {
    throw new Error('缺少 features —— Rubick 靠 features[].cmds 建立搜索索引，没有就搜不到');
  }
  const cmds = manifest.features.flatMap(item => item.cmds || []);
  if (!cmds.length) throw new Error('features[].cmds 为空，插件搜不到');
  return manifest;
}

function readRegistry() {
  if (!fs.existsSync(REGISTRY)) return [];
  const raw = fs.readFileSync(REGISTRY, 'utf8').trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`注册表格式异常（应为数组）：${REGISTRY}`);
  return parsed;
}

function writeRegistry(list) {
  fs.mkdirSync(path.dirname(REGISTRY), { recursive: true });
  fs.writeFileSync(REGISTRY, JSON.stringify(list), 'utf8');
}

function linkPlugin(dir, name) {
  fs.mkdirSync(MODULES, { recursive: true });
  const target = path.join(MODULES, name);
  if (fs.existsSync(target)) {
    let current = null;
    try {
      current = fs.realpathSync(target);
    } catch (error) {
      current = null;
    }
    if (current && path.resolve(current) === path.resolve(dir)) return 'already';
    const stat = fs.lstatSync(target);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      throw new Error(
        `${target} 是真实目录而不是链接。请先在 Rubick 里移除该插件，或手动删除这个目录后重跑。`
      );
    }
    fs.rmSync(target, { recursive: true, force: true });
  }
  // Windows 上目录符号链接需要管理员权限或开发者模式，junction 不需要
  try {
    fs.symlinkSync(dir, target, 'junction');
    return 'junction';
  } catch (error) {
    fs.symlinkSync(dir, target, 'dir');
    return 'symlink';
  }
}

function removeLink(name) {
  const target = path.join(MODULES, name);
  if (!fs.existsSync(target)) return false;
  fs.rmSync(target, { recursive: true, force: true });
  return true;
}

// 复刻 Rubick「开发者」安装本地插件时写进注册表的形状：
// { ...点击时传入的字段, ...链接目录里的 package.json, isDev: true, indexPath }
function registryEntry(manifest, indexPath) {
  return { name: PLUGIN.name, pluginType: manifest.pluginType, isDev: true, indexPath, ...manifest };
}

function check(verbose) {
  const report = [];
  const push = (level, text) => {
    report.push({ level, text });
    if (verbose) console.log(`  [${level}] ${text}`);
  };

  if (!fs.existsSync(PLUGIN_ROOT)) {
    push('FAIL', `Rubick 插件目录不存在：${PLUGIN_ROOT}（Rubick 还没运行过？）`);
    return report;
  }
  push('OK', `Rubick 插件目录：${PLUGIN_ROOT}`);

  let registry = [];
  try {
    registry = readRegistry();
    push('OK', `注册表可读，共 ${registry.length} 条：${REGISTRY}`);
  } catch (error) {
    push('FAIL', `注册表读取失败：${error.message}`);
    return report;
  }

  const target = path.join(MODULES, PLUGIN.name);
  if (!fs.existsSync(target)) {
    push('FAIL', `${PLUGIN.name} 没有出现在 node_modules 里（缺链接）`);
  } else {
    const real = fs.realpathSync(target);
    if (path.resolve(real) === PROJECT_DIR) push('OK', `${PLUGIN.name} → ${real}`);
    else push('FAIL', `${PLUGIN.name} 链接指向了别处：${real}`);
  }

  const entry = registry.find(item => item.name === PLUGIN.name);
  if (!entry) {
    push('FAIL', `注册表里没有 ${PLUGIN.name}`);
  } else if (entry.pluginType !== 'ui') {
    push('FAIL', `${PLUGIN.name} 的 pluginType = ${entry.pluginType}，应为 ui`);
  } else {
    push('OK', `注册表已登记 ${PLUGIN.name}（ui v${entry.version}）`);
  }

  for (const stale of LEGACY) {
    if (registry.some(item => item.name === stale)) push('WARN', `注册表里还有旧的 ${stale}（可跑一次安装清掉）`);
    if (fs.existsSync(path.join(MODULES, stale))) push('WARN', `node_modules 里还有旧的 ${stale}`);
  }

  return report;
}

function install() {
  const manifest = readManifest('UI 插件');
  const mainFile = path.join(PROJECT_DIR, manifest.main);
  if (!fs.existsSync(mainFile)) throw new Error(`main 指向的文件不存在：${mainFile}`);
  const indexPath = 'file:///' + mainFile.replace(/\\/g, '/');

  console.log('安装 启动收藏 / rubick-startup（单插件）');
  console.log(`  项目目录：${PROJECT_DIR}`);
  console.log(`  插件目录：${PLUGIN_ROOT}`);

  const link = linkPlugin(PROJECT_DIR, PLUGIN.name);
  console.log(`  node_modules 链接：${link}`);

  const registry = readRegistry();
  const entry = registryEntry(manifest, indexPath);
  const at = registry.findIndex(item => item.name === PLUGIN.name);
  if (at >= 0) registry[at] = { ...registry[at], ...entry };
  else registry.push(entry);
  console.log(`  注册表登记：${PLUGIN.name} v${manifest.version} → ${indexPath}`);

  // 清掉旧系统插件的登记与链接（它们会让 Rubick 每次启动都去 require 一个不存在的模块）
  let cleaned = 0;
  for (const stale of LEGACY) {
    if (registry.some(item => item.name === stale)) cleaned++;
    if (removeLink(stale)) cleaned++;
  }
  const kept = registry.filter(item => !LEGACY.includes(item.name));
  writeRegistry(kept);
  if (cleaned) console.log(`  已清理旧系统插件残留 ${cleaned} 处`);

  const report = check(false);
  for (const item of report) console.log(`  [${item.level}] ${item.text}`);
  const bad = report.filter(item => item.level === 'FAIL');
  if (bad.length) {
    console.error(`\n安装后体检发现 ${bad.length} 个问题，见上。`);
    process.exitCode = 1;
    return;
  }

  console.log('\n安装完成。下一步：');
  console.log('  1. 关掉插件再重新打开（页面文件是每次打开重新读的；改了页面不用重启 Rubick）。');
  console.log('  2. 搜索 fav 或 运行 打开「启动收藏」，右下角应显示「可以运行」。');
  console.log('  3. 输入 notepad 回车试运行。');
  console.log('  4. 排查日志（页面自己写的）：%TEMP%\\rubick-startup.log');
}

function uninstall() {
  console.log('卸载 启动收藏');
  let registry = [];
  try {
    registry = readRegistry();
  } catch (error) {
    console.error(`注册表读取失败：${error.message}`);
  }
  const before = registry.length;
  registry = registry.filter(item => item.name !== PLUGIN.name && !LEGACY.includes(item.name));
  if (registry.length !== before) {
    writeRegistry(registry);
    console.log(`  注册表移除 ${before - registry.length} 条登记`);
  } else {
    console.log('  注册表里没有本插件的登记');
  }
  for (const name of [PLUGIN.name, ...LEGACY]) {
    console.log(`  ${name} 链接${removeLink(name) ? '已删除' : '本来就不存在'}`);
  }
  console.log('完成。重启 Rubick 生效。');
}

if (MODE === 'check') {
  const report = check(true);
  if (report.some(item => item.level === 'FAIL')) process.exitCode = 1;
} else if (MODE === 'uninstall') {
  uninstall();
} else {
  install();
}
