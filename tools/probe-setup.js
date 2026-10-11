#!/usr/bin/env node
/**
 * 临时探测插件的安装 / 卸载（测完就卸，别留在 Rubick 里）
 *   node tools/probe-setup.js install
 *   node tools/probe-setup.js uninstall
 */
const fs = require('fs');
const path = require('path');

const PROBE_DIR = path.join(__dirname, 'probe-plugin');
const NAME = 'rubick-startup-probe';
const APPDATA = process.env.APPDATA;
const PLUGIN_ROOT = path.join(APPDATA, 'Rubick', 'rubick-plugins-new');
const REGISTRY = path.join(PLUGIN_ROOT, 'rubick-local-plugin.json');
const MODULES = path.join(PLUGIN_ROOT, 'node_modules');

const mode = process.argv[2];
if (mode !== 'install' && mode !== 'uninstall') {
  console.error('用法: node tools/probe-setup.js install|uninstall');
  process.exit(1);
}

const readRegistry = () => (fs.existsSync(REGISTRY) ? JSON.parse(fs.readFileSync(REGISTRY, 'utf8').trim() || '[]') : []);
const writeRegistry = list => fs.writeFileSync(REGISTRY, JSON.stringify(list), 'utf8');

if (mode === 'install') {
  const manifest = JSON.parse(fs.readFileSync(path.join(PROBE_DIR, 'package.json'), 'utf8'));
  fs.mkdirSync(MODULES, { recursive: true });
  const link = path.join(MODULES, NAME);
  if (fs.existsSync(link)) fs.rmSync(link, { recursive: true, force: true });
  fs.symlinkSync(PROBE_DIR, link, 'junction');

  const registry = readRegistry().filter(item => item.name !== NAME);
  registry.push({
    name: NAME,
    pluginType: 'ui',
    isDev: true,
    indexPath: 'file:///' + path.join(PROBE_DIR, manifest.main).replace(/\\/g, '/'),
    ...manifest
  });
  writeRegistry(registry);
  console.log(`探测插件已安装：搜索 probe 或 探测 打开`);
  console.log(`日志：%TEMP%\\rubick-startup-input-probe.log`);
} else {
  const registry = readRegistry().filter(item => item.name !== NAME);
  writeRegistry(registry);
  const link = path.join(MODULES, NAME);
  if (fs.existsSync(link)) fs.rmSync(link, { recursive: true, force: true });
  console.log('探测插件已卸载');
}
