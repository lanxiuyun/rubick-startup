const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

async function main() {
  if (process.platform !== 'win32') {
    console.log('SKIP real cmd execution: Windows only');
    return;
  }
  const source = fs.readFileSync(path.join(__dirname, '../src/runtime.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  const model = await import('../src/model.mjs');
  const launches = [];
  const childProcess = require('child_process');
  const hostRequire = name => name !== 'child_process' ? require(name) : {
    spawnSync: childProcess.spawnSync,
    spawn: (exe, args, options) => {
      launches.push({ exe, args, options });
      const child = { once: (event, callback) => { if (event === 'spawn') setTimeout(callback, 0); return child; }, unref: () => {} };
      return child;
    }
  };
  vm.runInNewContext(code, {
    exports, require: () => model,
    window: { require: hostRequire }, console: { info: () => {} }, setTimeout, Uint8Array, TextDecoder
  });
  await exports.spawnCommand('ver');
  await assert.rejects(exports.spawnCommand('rubick_startup_nonexistent_command_12345'), /rubick_startup_nonexistent_command_12345/);
  const count = launches.length;
  await assert.rejects(exports.spawnCommand('rubick_startup_nonexistent_command_12345 --help'), /rubick_startup_nonexistent_command_12345/);
  assert.strictEqual(launches.length, count, 'Missing tools must not launch a terminal');
  await exports.spawnCommand('where.exe missing-tool');
  await exports.spawnCommand('echo test-error >&2 & exit /b 7');
  await exports.spawnCommand('exit /b 9');
  await exports.spawnCommand(`"${process.execPath}" missing-script.js`);
  assert(launches.every(item => item.args.includes('/k') && item.options.windowsHide === false));
  console.log('PASS real Windows PATH lookup, quoted executable, arguments, builtins and launch-only success');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
