// 用最小 DOM/模块桩把 public/index.html 的内联脚本真正跑起来。
// 单插件版的架构：页面直接 require('child_process')，没有 IPC、没有 preload。
// 所以这里既不模拟 ipcRenderer，也不模拟桥接 —— 直接把 child_process 桩进去。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', 'public', 'index.html');
const html = fs.readFileSync(HTML, 'utf8');
const scriptMatch = /<script>([\s\S]*?)<\/script>/.exec(html);
assert(scriptMatch, 'index.html 里找不到内联 <script>');
const SCRIPT = scriptMatch[1];

// ---------- 极简 DOM ----------
class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...names) { for (const n of names) if (n) this.set.add(n); this.sync(); }
  remove(...names) { for (const n of names) this.set.delete(n); this.sync(); }
  contains(name) { return this.set.has(name); }
  toggle(name, force) {
    const want = force === undefined ? !this.set.has(name) : !!force;
    if (want) this.set.add(name); else this.set.delete(name);
    this.sync();
    return want;
  }
  sync() { this.el._className = [...this.set].join(' '); }
}

class El {
  constructor(tag, id) {
    this.tagName = (tag || 'div').toUpperCase();
    this.id = id || '';
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.src = '';
    this.dataset = {};
    this.classList = new ClassList(this);
    this._className = '';
    this._listeners = new Map();
  }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); this._className = v; }
  get className() { return [...this.classList.set].join(' '); }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    this._listeners.set(type, (this._listeners.get(type) || []).filter(x => x !== fn));
  }
  dispatch(type, event = {}) {
    const ev = Object.assign({ type, target: this, preventDefault() {}, stopPropagation() {} }, event);
    for (const fn of [...(this._listeners.get(type) || [])]) fn(ev);
  }
  focus() { this._focused = true; }
  closest(sel) {
    const m = /^\[([\w-]+)\]$/.exec(sel);   // 只支持 [data-xxx]，测试够用
    if (!m) return null;
    return this.dataset[m[1]] !== undefined ? this : null;
  }
}

// ---------- 宿主环境 ----------
// opts.spawn           自定义 spawn
// opts.skipChildProcess 模拟"页面拿不到 child_process"
function makeHost(opts = {}) {
  const nodes = new Map();
  const ensure = id => {
    if (!nodes.has(id)) nodes.set(id, new El('div', id));
    return nodes.get(id);
  };
  for (const id of ['count', 'sectionTitle', 'results', 'query', 'run', 'status', 'toast', 'diag', 'brandLogo']) ensure(id);

  const filters = new El('div');
  const allBtn = new El('button'); allBtn.dataset.filter = 'all';
  const favBtn = new El('button'); favBtn.dataset.filter = 'favorites';

  const documentStub = {
    getElementById: id => nodes.get(id) || null,
    querySelector: sel => (sel === '.filters' ? filters : null),
    querySelectorAll: sel => (sel === '.filter' ? [allBtn, favBtn] : []),
    addEventListener: () => {}
  };

  const windowStub = { addEventListener: () => {}, dispatchEvent: () => {} };
  const timers = [];
  const store = new Map();
  const spawned = [];
  const logWrites = [];

  const state = { spawned, store, timers, logWrites, nodes };

  const makeChild = () => {
    const handlers = new Map();
    const child = {
      once(event, fn) {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event).push(fn);
        return child;
      },
      fire(event) {
        const args = event === 'error' ? [new Error('模拟：启动失败')] : [];
        for (const fn of [...(handlers.get(event) || [])]) fn(...args);
      },
      handlers,
      unref() { child.unreffed = true; }
    };
    return child;
  };

  const spawnImpl = opts.spawn || ((exe, args, options) => {
    const child = makeChild();
    spawned.push({ exe, args, options, child });
    setImmediate(() => child.fire('spawn'));
    return child;
  });

  const rubickStub = {
    db: {
      get: id => (store.has(id) ? store.get(id) : null),
      put: doc => { store.set(doc._id, { ...doc }); return { ok: true }; }
    },
    onPluginReady: () => {},
    setExpendHeight: () => {}
  };

  const sandbox = {
    console, JSON, Math, Date, Map, Set, Promise, Object, Array, String, Number,
    Boolean, RegExp, Error, isNaN, parseInt, parseFloat,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    setInterval: () => 0,
    localStorage: { getItem: () => null, setItem: () => {} },
    document: documentStub,
    window: windowStub
  };
  windowStub.document = documentStub;
  windowStub.localStorage = sandbox.localStorage;
  windowStub.rubick = rubickStub;
  sandbox.rubick = rubickStub;

  sandbox.require = request => {
    if (request === 'child_process') {
      if (opts.skipChildProcess) throw new Error('模拟：取不到 child_process');
      return { spawn: spawnImpl };
    }
    if (request === 'electron') {
      if (opts.noIpc) throw new Error('模拟：取不到 electron');
      return { ipcRenderer: { send: () => {}, on: () => {}, once: () => {}, removeListener: () => {} } };
    }
    if (request === 'fs') {
      return {
        appendFileSync: (file, data) => { logWrites.push({ file, data }); },
        existsSync: () => false,
        statSync: () => ({ size: 0 }),
        writeFileSync: () => {}
      };
    }
    if (request === 'os') return { tmpdir: () => 'C:\\Temp' };
    if (request === 'path') return path;
    throw new Error(`测试宿主不支持 require('${request}')`);
  };

  return {
    state,
    nodes,
    el: id => nodes.get(id),
    window: windowStub,
    runScript() {
      const context = vm.createContext(sandbox);
      vm.runInContext(SCRIPT, context, { filename: 'public/index.html#inline' });
    }
  };
}

const settle = () => new Promise(resolve => setImmediate(() => setImmediate(() => setImmediate(resolve))));
let pass = 0;
const ok = name => { pass++; console.log('  PASS  ' + name); };

async function main() {
  console.log('== 1. 脚本能在最小 DOM 环境里跑起来，且不依赖任何 IPC ==');
  const host = makeHost();
  host.runScript();
  await settle();
  ok('内联脚本执行完成，未抛异常（无 preload、无 ipcRenderer 参与）');

  console.log('== 2. 状态显示运行环境可用 ==');
  assert.strictEqual(host.el('status').textContent, '可以运行', `状态文案：${host.el('status').textContent}`);
  assert(host.el('status').classList.contains('bridge-ok'), '未加上可用样式');
  assert(/可直接执行/.test(host.el('diag').textContent), `诊断串：${host.el('diag').textContent}`);
  ok('右下角显示「可以运行」，诊断串报告可直接执行');

  console.log('== 3. 点状态可重新检测（同步，不需要重启任何东西）==');
  host.el('status').dispatch('click');
  assert.strictEqual(host.el('status').textContent, '可以运行');
  ok('点击状态立即刷新检测结果');

  console.log('== 4. 回车执行：页面直接 spawn，命令原文交给 cmd.exe ==');
  host.el('query').value = 'notepad';
  host.el('query').dispatch('keydown', { key: 'Enter' });
  await settle();
  assert.strictEqual(host.state.spawned.length, 1, `spawn 次数应为 1，实际 ${host.state.spawned.length}`);
  const call = host.state.spawned[0];
  assert.strictEqual(call.exe, 'cmd.exe');
  // 注意：vm 沙箱里传出来的数组属于另一个 realm，deepStrictEqual 会因为原型不同而失败，
  // 所以这里比较序列化结果。
  assert.strictEqual(JSON.stringify(call.args), JSON.stringify(['/d', '/s', '/c', 'notepad']), `参数不对：${JSON.stringify(call.args)}`);
  assert.strictEqual(call.options.detached, true);
  assert.strictEqual(call.options.windowsHide, true);
  assert.strictEqual(call.child.unreffed, true, '没有 unref，Rubick 退出会被子进程拖住');
  ok('spawn(cmd.exe, [/d /s /c <原文>], {detached, windowsHide}) + unref');

  console.log('== 5. 历史落库 + 状态更新 + 落盘日志 ==');
  assert.strictEqual(host.el('count').textContent, 1, '历史条数没有 +1');
  const saved = host.state.store.get('rubick-startup/history-v2');
  assert(saved && saved.records.length === 1, '历史没有写进 rubick.db');
  assert.strictEqual(saved.records[0].command, 'notepad');
  assert.strictEqual(saved.records[0].kind, 'command');
  assert.strictEqual(host.el('status').textContent, '已交给 Windows 启动', `状态：${host.el('status').textContent}`);
  const logText = host.state.logWrites.map(w => w.data).join('');
  assert(/已启动/.test(logText), `日志里没有记录这次启动：${logText}`);
  assert(/rubick-startup\.log$/.test(host.state.logWrites[0].file), `日志路径不对：${host.state.logWrites[0].file}`);
  ok('执行后写入历史、更新状态，并落盘日志（%TEMP%\\rubick-startup.log）');

  console.log('== 6. 空输入不执行 ==');
  host.el('query').value = '   ';
  host.el('query').dispatch('keydown', { key: 'Enter' });
  await settle();
  assert.strictEqual(host.state.spawned.length, 1, '空输入竟然触发了 spawn');
  ok('空输入不触发运行');

  console.log('== 7. 路径识别为 path ==');
  host.el('query').value = 'C:\\dlcv\\demo';
  host.el('query').dispatch('keydown', { key: 'Enter' });
  await settle();
  const saved2 = host.state.store.get('rubick-startup/history-v2');
  assert.strictEqual(saved2.records[0].kind, 'path', `kind 应为 path，实际 ${saved2.records[0].kind}`);
  ok('Windows 路径识别为「路径/程序」');

  console.log('== 8. 启动出错时如实报错，不假装成功 ==');
  const failHost = makeHost({
    spawn(exe, args, options) {
      const handlers = new Map();
      const child = {
        once(event, fn) { if (!handlers.has(event)) handlers.set(event, []); handlers.get(event).push(fn); return child; },
        fire(event) { for (const fn of [...(handlers.get(event) || [])]) fn(); },
        unref() {}
      };
      failHost.state.spawned.push({ exe, args, options, child });
      setImmediate(() => child.fire('error', new Error('模拟：命令无法启动')));
      return child;
    }
  });
  failHost.runScript();
  await settle();
  failHost.el('query').value = 'this-command-does-not-exist-xyz';
  failHost.el('query').dispatch('keydown', { key: 'Enter' });
  await settle();
  assert.strictEqual(failHost.el('status').textContent, '启动失败', `状态：${failHost.el('status').textContent}`);
  assert(/失败/.test(failHost.state.logWrites.map(w => w.data).join('')), '日志里没有记录失败');
  ok('子进程报错时状态显示「启动失败」并写日志');

  console.log('== 9. 页面拿不到 child_process 时：拦住执行并说明原因 ==');
  const deadHost = makeHost({ skipChildProcess: true });
  deadHost.runScript();
  await settle();
  assert.strictEqual(deadHost.el('status').textContent, '无法执行命令', `状态：${deadHost.el('status').textContent}`);
  assert(deadHost.el('status').classList.contains('bridge-missing'), '未加上不可用样式');
  assert(/不可用/.test(deadHost.el('diag').textContent), `诊断串：${deadHost.el('diag').textContent}`);
  deadHost.el('query').value = 'notepad';
  deadHost.el('query').dispatch('keydown', { key: 'Enter' });
  await settle();
  assert.strictEqual(deadHost.state.spawned.length, 0, '不可用时竟然还尝试执行');
  assert(/启动失败/.test(deadHost.el('status').textContent), `应报错，实际：${deadHost.el('status').textContent}`);
  ok('不可用时不执行，状态与诊断串如实说明原因（不让用户以为发出去了）');

  console.log('== 10. 品牌图标走 data URI（官方要求在线地址，本地文件不被支持）==');
  assert(/^data:image\/svg\+xml;base64,/.test(host.el('brandLogo').src), `图标 src 不对：${String(host.el('brandLogo').src).slice(0, 40)}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert(/^data:image\/svg\+xml;base64,/.test(manifest.logo), '清单里的 logo 不是 data URI');
  assert(!fs.existsSync(path.join(__dirname, '..', 'public', 'logo.svg')), '本地 logo.svg 应该已删除');
  ok('图标走 data URI，不再依赖本地文件');

  console.log('\n全部通过：' + pass + ' 项');
}

main().catch(error => {
  console.error('\nFAIL:', error && error.stack || error);
  process.exitCode = 1;
});
