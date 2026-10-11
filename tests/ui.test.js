// 用最小 DOM/模块桩把 public/index.html 的内联脚本真正跑起来。
//
// 这轮新增的重点是"输入层"：Rubick 搜索框 ⇄ 插件页面。
// 依据是真机探测到的机制（不再是猜测）：
//   - rubick.setSubInput(onChange) 注册回调，载荷是 {text}
//   - rubick.setSubInputValue(text) 反向写入搜索框
//   - 搜索框的按键被 sendInputEvent 灌进页面 → window keydown 能收到回车
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
    const ev = Object.assign({ type, target: this, key: '', preventDefault() {}, stopPropagation() {} }, event);
    for (const fn of [...(this._listeners.get(type) || [])]) fn(ev);
  }
  focus() { this._focused = true; }
  closest(sel) {
    const m = /^\[([\w-]+)\]$/.exec(sel);
    if (!m) return null;
    return this.dataset[m[1]] !== undefined ? this : null;
  }
}

// ---------- 宿主环境 ----------
// opts.spawn             自定义 spawn
// opts.skipChildProcess  模拟取不到 child_process
// opts.noRubick          模拟没有 window.rubick（纯浏览器预览）
function makeHost(opts = {}) {
  const nodes = new Map();
  const ensure = id => {
    if (!nodes.has(id)) nodes.set(id, new El('div', id));
    return nodes.get(id);
  };
  for (const id of ['count', 'sectionTitle', 'results', 'query', 'run', 'status', 'toast', 'diag', 'brandLogo', 'keyhint']) ensure(id);

  const filters = new El('div');
  const allBtn = new El('button'); allBtn.dataset.filter = 'all';
  const favBtn = new El('button'); favBtn.dataset.filter = 'favorites';

  const documentStub = {
    getElementById: id => nodes.get(id) || null,
    querySelector: sel => (sel === '.filters' ? filters : null),
    querySelectorAll: sel => (sel === '.filter' ? [allBtn, favBtn] : []),
    addEventListener: () => {}
  };

  const windowListeners = new Map();
  const windowStub = {
    addEventListener: (type, fn) => {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
    dispatchEvent: event => {
      for (const fn of [...(windowListeners.get(event.type) || [])]) fn(event);
    },
    // 模拟"搜索框的按键被 sendInputEvent 灌进页面"
    fireKey: (key, extra = {}) => {
      const ev = Object.assign({ type: 'keydown', key, preventDefault() {}, stopPropagation() {} }, extra);
      for (const fn of [...(windowListeners.get('keydown') || [])]) fn(ev);
    }
  };

  const timers = [];
  const store = new Map();
  const spawned = [];
  const logWrites = [];
  let clock = 1000000;   // 虚拟时间起点
  const state = { spawned, store, timers, logWrites, nodes, advance: ms => { clock += ms; } };

  // 记录我们调用了哪些 rubick API（这是输入层的核心断言对象）
  const rubickCalls = { setSubInput: [], setSubInputValue: [], setExpendHeight: [] };
  let subInputCallback = null;

  const rubickStub = opts.noRubick ? null : {
    db: {
      get: id => (store.has(id) ? store.get(id) : null),
      put: doc => { store.set(doc._id, { ...doc }); return { ok: true }; }
    },
    setSubInput(onChange, placeholder, isFocus) {
      rubickCalls.setSubInput.push({ placeholder, isFocus });
      subInputCallback = typeof onChange === 'function' ? onChange : null;
    },
    setSubInputValue(text) {
      rubickCalls.setSubInputValue.push(text);
      // 真实 Rubick 会把值写进搜索框，并回调 sendSubInputChangeEvent 回来
      if (typeof opts.onSetSubInputValue === 'function') opts.onSetSubInputValue(text);
    },
    onPluginReady: () => {},
    setExpendHeight: h => { rubickCalls.setExpendHeight.push(h); }
  };

  const makeChild = () => {
    const handlers = new Map();
    const child = {
      once(event, fn) { if (!handlers.has(event)) handlers.set(event, []); handlers.get(event).push(fn); return child; },
      fire(event) {
        const args = event === 'error' ? [new Error('模拟：启动失败')] : [];
        for (const fn of [...(handlers.get(event) || [])]) fn(...args);
      },
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
  // 虚拟时钟：让"180ms 去重窗口"这类时间逻辑可测，不必真的 sleep
  windowStub.__rubickStartupNow = () => clock;
  windowStub.__rubickStartupSchedule = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  if (rubickStub) { windowStub.rubick = rubickStub; sandbox.rubick = rubickStub; }

  sandbox.require = request => {
    if (request === 'child_process') {
      if (opts.skipChildProcess) throw new Error('模拟：取不到 child_process');
      return { spawn: spawnImpl };
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
    rubickCalls,
    nodes,
    el: id => nodes.get(id),
    window: windowStub,
    // 模拟 Rubick 把搜索框的新文本推给插件
    searchBoxChange(text) {
      assert(subInputCallback, '插件没有注册 setSubInput 回调');
      subInputCallback({ text });
    },
    hasSubInput: () => !!subInputCallback,
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
  console.log('== 1. 脚本能跑起来，并接管 Rubick 搜索框 ==');
  const host = makeHost({
    // 模拟 Rubick：写入搜索框后回调把新值送回插件
    onSetSubInputValue: text => {
      if (hostRef && hostRef.hasSubInput()) hostRef.searchBoxChange(text);
    }
  });
  let hostRef = host;
  host.runScript();
  await settle();
  assert(host.hasSubInput(), '没有注册 rubick.setSubInput 回调 —— 输入层没接上');
  assert.strictEqual(host.rubickCalls.setSubInput.length, 1, 'setSubInput 调用次数不为 1');
  assert(host.rubickCalls.setSubInput[0].placeholder, 'setSubInput 没有给占位提示');
  ok('调用 rubick.setSubInput(onChange, 占位提示) 接管搜索框');

  console.log('== 2. 在 Rubick 搜索框打字 → 插件实时收到 ==');
  host.searchBoxChange('note');
  assert.strictEqual(host.el('query').value, 'note', `插件输入框没有同步：${host.el('query').value}`);
  host.searchBoxChange('notepad');
  assert.strictEqual(host.el('query').value, 'notepad');
  ok('搜索框变化 → rubick 回调 → 插件输入框同步（用于实时过滤）');

  console.log('== 3. 搜索框回车 → 直接执行（不再需要第二次回车）==');
  host.state.spawned.length = 0;
  host.window.fireKey('Enter');
  await settle();
  assert.strictEqual(host.state.spawned.length, 1, `回车没有触发执行，spawn 次数 ${host.state.spawned.length}`);
  const call = host.state.spawned[0];
  assert.strictEqual(call.exe, 'cmd.exe');
  assert.strictEqual(JSON.stringify(call.args), JSON.stringify(['/d', '/s', '/c', 'notepad']));
  assert.strictEqual(call.options.detached, true);
  assert.strictEqual(call.options.windowsHide, true);
  assert.strictEqual(call.child.unreffed, true, '没有 unref');
  assert.strictEqual(host.el('status').textContent, '已交给 Windows 启动');
  ok('搜索框回车 → 执行搜索框里的原文 → spawn(cmd.exe /d /s /c <原文>)');

  console.log('== 4. 执行后写入历史 ==');
  const saved = host.state.store.get('rubick-startup/history-v2');
  assert(saved && saved.records.length === 1, '历史没有落库');
  assert.strictEqual(saved.records[0].command, 'notepad');
  assert.strictEqual(saved.records[0].kind, 'command');
  assert.strictEqual(host.el('count').textContent, 1);
  ok('执行后历史落库并刷新计数');

  console.log('== 5. 接管搜索框后，镜像输入框设为只读（避免改了不起作用）==');
  assert.strictEqual(host.el('query').readOnly, true, '接管成功后应把镜像框设为只读');
  assert(/Rubick 搜索框/.test(host.el('query').placeholder), `占位提示不对：${host.el('query').placeholder}`);
  ok('镜像框只读，提示用户去 Rubick 搜索框输入');

  console.log('== 6. 镜像框不再写回搜索框（单向，天然无回环）==');
  host.rubickCalls.setSubInputValue.length = 0;
  host.el('query').value = 'calc';
  host.el('query').dispatch('input', { target: { value: 'calc' } });
  assert.strictEqual(host.rubickCalls.setSubInputValue.length, 0, '镜像框不该写回搜索框');
  ok('插件不反向写搜索框，消除双向同步歧义');

  console.log('== 7. 执行后清空搜索框（否则再按回车会重复执行）==');
  host.state.spawned.length = 0;
  host.state.advance(500);   // 越过 180ms 去重窗口
  host.searchBoxChange('notepad');
  host.window.fireKey('Enter');
  await settle();
  assert.strictEqual(host.state.spawned.length, 1, `执行次数应为 1，实际 ${host.state.spawned.length}`);
  assert(
    host.rubickCalls.setSubInputValue.includes(''),
    `执行后没有清空搜索框，记录：${JSON.stringify(host.rubickCalls.setSubInputValue)}`
  );
  assert.strictEqual(host.el('query').value, '', `搜索框内容应已清空，实际：${host.el('query').value}`);
  ok('执行后把搜索框置空，避免重复执行、也让 Rubick 不再拿原文匹配插件');

  console.log('== 8. 去重窗口：同一次回车从两条路到达只算一次 ==');
  host.state.advance(500);
  host.searchBoxChange('calc');
  host.state.spawned.length = 0;
  host.window.fireKey('Enter');                              // 搜索框转发的回车
  host.el('query').dispatch('keydown', { key: 'Enter' });    // 页面自己的回车
  await settle();
  assert.strictEqual(host.state.spawned.length, 1, `去重失败，执行了 ${host.state.spawned.length} 次`);
  ok('180ms 内的重复回车只执行一次');

  console.log('== 9. 快速连打两条命令不被误伤 ==');
  host.state.advance(500);   // 超过窗口
  host.searchBoxChange('calc');
  host.window.fireKey('Enter');
  await settle();
  assert.strictEqual(host.state.spawned.length, 2, `第二条命令被去重窗口误伤，执行 ${host.state.spawned.length} 次`);
  ok('超过去重窗口后可以连续执行不同命令');

  console.log('== 10. 空输入不执行 ==');
  host.state.advance(500);
  host.state.spawned.length = 0;
  host.window.fireKey('Enter');
  await settle();
  assert.strictEqual(host.state.spawned.length, 0, '空输入竟然触发了执行');
  ok('空输入不触发执行');

  console.log('== 11. 路径识别为 path ==');
  host.state.advance(500);
  host.searchBoxChange('C:\\dlcv\\demo');
  host.window.fireKey('Enter');
  await settle();
  const saved2 = host.state.store.get('rubick-startup/history-v2');
  assert.strictEqual(saved2.records[0].kind, 'path', `kind 应为 path，实际 ${saved2.records[0].kind}`);
  ok('Windows 路径识别为「路径/程序」');

  console.log('== 12. 启动出错如实报错 ==');
  const failHost = makeHost({
    spawn(exe, args, options) {
      const handlers = new Map();
      const child = {
        once(event, fn) { if (!handlers.has(event)) handlers.set(event, []); handlers.get(event).push(fn); return child; },
        fire(event) { for (const fn of [...(handlers.get(event) || [])]) fn(new Error('模拟：命令无法启动')); },
        unref() {}
      };
      failHost.state.spawned.push({ exe, args, options, child });
      setImmediate(() => child.fire('error'));
      return child;
    }
  });
  failHost.runScript();
  await settle();
  failHost.searchBoxChange('this-command-does-not-exist-xyz');
  failHost.window.fireKey('Enter');
  await settle();
  assert.strictEqual(failHost.el('status').textContent, '启动失败', `状态：${failHost.el('status').textContent}`);
  assert(/失败/.test(failHost.state.logWrites.map(w => w.data).join('')), '日志没记录失败');
  ok('子进程报错时显示「启动失败」并写日志');

  console.log('== 13. 取不到 child_process 时拦住执行并说明原因 ==');
  const deadHost = makeHost({ skipChildProcess: true });
  deadHost.runScript();
  await settle();
  assert.strictEqual(deadHost.el('status').textContent, '无法执行命令', `状态：${deadHost.el('status').textContent}`);
  assert(deadHost.el('status').classList.contains('bridge-missing'), '未加不可用样式');
  deadHost.searchBoxChange('notepad');
  deadHost.state.spawned.length = 0;
  deadHost.window.fireKey('Enter');
  await settle();
  assert.strictEqual(deadHost.state.spawned.length, 0, '不可用时竟然尝试执行');
  assert(/启动失败/.test(deadHost.el('status').textContent), `应报错，实际：${deadHost.el('status').textContent}`);
  ok('不可用时不执行，状态如实说明原因');

  console.log('== 14. 没有 window.rubick 时退化为独立输入框 ==');
  const plainHost = makeHost({ noRubick: true });
  plainHost.runScript();
  await settle();
  assert.strictEqual(plainHost.rubickCalls.setSubInput.length, 0, '没有 rubick 时不该调 setSubInput');
  plainHost.el('query').value = 'notepad';
  plainHost.el('query').dispatch('keydown', { key: 'Enter' });
  await settle();
  assert.strictEqual(plainHost.state.spawned.length, 1, '独立输入框下回车应该能执行');
  ok('没有 Rubick 环境时仍可用插件自己的输入框（浏览器预览）');

  console.log('== 15. 品牌图标走 data URI ==');
  assert(/^data:image\/svg\+xml;base64,/.test(host.el('brandLogo').src), '图标不是 data URI');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert(/^data:image\/svg\+xml;base64,/.test(manifest.logo), '清单 logo 不是 data URI');
  ok('图标走 data URI');

  console.log('\n全部通过：' + pass + ' 项');
}

main().catch(error => {
  console.error('\nFAIL:', error && error.stack || error);
  process.exitCode = 1;
});
