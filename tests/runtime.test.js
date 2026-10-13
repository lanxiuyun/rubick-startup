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
  vm.runInNewContext(code, {
    exports, require: () => ({ KEY: 'test', groupCounts: () => [] }),
    window: { require }, console: { info: () => {} }, setTimeout, Uint8Array, TextDecoder
  });
  await exports.spawnCommand('ver');
  await assert.rejects(exports.spawnCommand('rubick_startup_nonexistent_command_12345'), /rubick_startup_nonexistent_command_12345/);
  await assert.rejects(exports.spawnCommand('echo test-error >&2 & exit /b 7'), /test-error/);
  await assert.rejects(exports.spawnCommand('exit /b 9'), /命令退出码：9/);
  await assert.rejects(exports.spawnCommand('echo test-中文错误 >&2 & exit /b 1'), /test-中文错误/);
  console.log('PASS real Windows cmd: success, unknown command, stderr, exit code and Chinese error decoding');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
