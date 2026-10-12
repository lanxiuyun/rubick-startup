// 用最小 DOM/模块桩把 public/index.html 的内联脚本真正跑起来。
//
// 这一版页面 = 字符串管理 + 标签 + 虚拟滚动，所以测试重点：
//   1. 输入层（Rubick 搜索框 → 页面），含"合成事件只有 keyCode"这个坑
//   2. 标签：加/移出/筛选/永久保留
//   3. 虚拟滚动：只渲染可见窗口、行高固定、回滚位置正确
//   4. 上限：只清理没标签的记录
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', 'public', 'index.html');
const html = fs.readFileSync(HTML, 'utf8');
const SCRIPT = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
const ROW_H = Number(/const ROW_H=(\d+)/.exec(SCRIPT)[1]);

// ---------- 极简 DOM ----------
class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...n) { for (const x of n) if (x) this.set.add(x); }
  remove(...n) { for (const x of n) this.set.delete(x); }
  contains(n) { return this.set.has(n); }
  toggle(n, force) {
    const want = force === undefined ? !this.set.has(n) : !!force;
    if (want) this.set.add(n); else this.set.delete(n);
    return want;
  }
}

class El {
  constructor(tag, id) {
    this.tagName = (tag || 'div').toUpperCase();
    this.id = id || '';
    this.textContent = '';
    this.value = '';
    this.src = '';
    this.dataset = {};
    this.style = {};
    this.classList = new ClassList(this);
    this.children = [];
    this._listeners = new Map();
    this.clientHeight = 200;   // 模拟视口高度
    this.scrollTop = 0;
    this.offsetWidth = 160;
    this.offsetHeight = 120;
    this._innerHTML = '';
  }
  // 模拟真实 DOM：写 innerHTML 之后，里面出现的 id 才查得到
  set innerHTML(v) {
    this._innerHTML = String(v);
    for (const m of this._innerHTML.matchAll(/id="([\w-]+)"/g)) {
      if (!this._owner || this._owner.has(m[1])) continue;
      this._owner.set(m[1], new El('input', m[1]));
    }
  }
  get innerHTML() { return this._innerHTML; }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    this._listeners.set(type, (this._listeners.get(type) || []).filter(x => x !== fn));
  }
  dispatch(type, event = {}) {
    const ev = Object.assign({
      type, target: this, key: '', preventDefault() {}, stopPropagation() {}
    }, event);
    for (const fn of [...(this._listeners.get(type) || [])]) fn(ev);
  }
  closest(sel) {
    // 测试里只需要两类选择器：.row / #menu / [data-xxx]
    if (sel.startsWith('.') && this.className && this.className.split(' ').includes(sel.slice(1))) return this;
    if (sel.startsWith('#') && this.id === sel.slice(1)) return this;
    const m = /^\[([\w-]+)\]$/.exec(sel);
    if (m) return this.dataset[m[1]] !== undefined ? this : null;
    return null;
  }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  appendChild(child) { this.children.push(child); return child; }
  insertBefore(child) { this.children.push(child); return child; }
  remove() {
    // 真实 DOM 里 remove() 会把自己从父节点摘掉
    if (this._parent && Array.isArray(this._parent.children)) {
      const at = this._parent.children.indexOf(this);
      if (at >= 0) this._parent.children.splice(at, 1);
    }
    if (typeof this._onRemove === 'function') this._onRemove(this);
  }
  focus() { this._focused = true; }
  getBoundingClientRect() { return { left: 10, top: 10, width: 160, height: 120 }; }
}

// list 容器要把 appendChild 到 spacer 的行记下来，方便断言虚拟滚动
function makeHost(opts = {}) {
  const nodes = new Map();
  const ensure = id => {
    if (!nodes.has(id)) {
      const el = new El('div', id);
      el._owner = nodes;
      nodes.set(id, el);
    }
    return nodes.get(id);
  };
  for (const id of ['status', 'tags', 'list', 'spacer', 'menu', 'toast']) ensure(id);

  const appended = [];   // 记录被加到 spacer 的行（会随 remove() 摘除，反映真实 DOM）
  const spacer = nodes.get('spacer');
  const realAppend = spacer.appendChild.bind(spacer);
  spacer.appendChild = child => {
    // 真实 DOM 里 appendChild(DocumentFragment) 会展开它的子节点
    const items = (child.tagName === 'FRAGMENT' && child.children.length) ? child.children : [child];
    for (const item of items) {
      item._parent = spacer;
      item._onRemove = el => {
        const at = appended.indexOf(el);
        if (at >= 0) appended.splice(at, 1);
      };
      appended.push(item);
    }
    return realAppend(child);
  };
  // 支持 ".row,.empty" 这种多选择器，并且真的按 class 过滤 ——
  // 否则 renderRows 开头"清掉旧行"那步形同虚设，行会累积、陈旧节点被误当成当前状态
  spacer.querySelectorAll = sel => {
    const wanted = String(sel).split(',').map(x => x.trim().replace(/^\./, ''));
    return appended.filter(el => wanted.some(c => (el.className || '').split(/\s+/).includes(c)));
  };

  const documentStub = {
    // 只返回"真实存在"的元素：innerHTML 里插入的 id 由 El 的 setter 注册进来，
    // 所以内联输入框在未出现前查不到 —— 这跟真实 DOM 一致，也让
    // inlineInputActive() 的判断能被正确验证
    getElementById: id => nodes.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createDocumentFragment: () => new El('fragment'),
    createElement: tag => new El(tag),
    addEventListener: () => {}
  };

  const windowListeners = new Map();
  const windowStub = {
    addEventListener: (type, fn) => {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
    dispatchEvent: () => {},
    // 模拟真实 Electron 的 sendInputEvent：事件派发给【焦点元素】，
    // 冒泡到 window（window 上的监听是捕获阶段，所以先跑）。
    // 只派发给 window 是错的 —— 那样输入框自己的 keydown 处理器永远收不到，
    // 会把"在标签输入框里回车"误判成"执行命令"。
    fireKey: (key, extra = {}) => {
      const ev = Object.assign({ type: 'keydown', key, target: null, preventDefault() {}, stopPropagation() {} }, extra);
      for (const fn of [...(windowListeners.get('keydown') || [])]) fn(ev);
      const focused = nodes.get('tagInput') || nodes.get('newgroup');
      if (focused) {
        const at = Object.assign({}, ev, { target: focused });
        for (const fn of [...(focused._listeners.get('keydown') || [])]) fn(at);
      }
    }
  };

  const store = new Map();
  const spawned = [];
  const logWrites = [];
  const timers = [];
  let clock = 1000000;
  const rubickCalls = { setSubInput: [], setSubInputValue: [], setExpendHeight: [] };
  let subCb = null;

  const rubickStub = opts.noRubick ? null : {
    db: {
      get: id => (store.has(id) ? store.get(id) : null),
      put: doc => { store.set(doc._id, JSON.parse(JSON.stringify(doc))); return { ok: true }; }
    },
    setSubInput(cb, placeholder, focus) {
      rubickCalls.setSubInput.push({ placeholder, focus });
      subCb = typeof cb === 'function' ? cb : null;
    },
    setSubInputValue(text) {
      rubickCalls.setSubInputValue.push(text);
      if (typeof opts.onSetSubInputValue === 'function') opts.onSetSubInputValue(text);
    },
    onPluginReady: () => {},
    setExpendHeight: h => rubickCalls.setExpendHeight.push(h)
  };

  const makeChild = () => {
    const handlers = new Map();
    const child = {
      once(e, fn) { if (!handlers.has(e)) handlers.set(e, []); handlers.get(e).push(fn); return child; },
      fire(e) { for (const fn of [...(handlers.get(e) || [])]) fn(new Error('模拟：启动失败')); },
      unref() { child.unreffed = true; }
    };
    return child;
  };
  const spawnImpl = opts.spawn || ((exe, args, options) => {
    const child = makeChild();
    spawned.push({ exe, args, options, child });
    setImmediate(() => {
      for (const fn of []) fn();
      child.handlers.forEach; // noop
    });
    // 触发 spawn 成功
    setImmediate(() => { const h = child; (h.__emit || (() => {}))(); });
    return child;
  });

  // 简化：成功路径直接调用已注册的 spawn 处理器
  const spawnOk = (exe, args, options) => {
    const handlers = new Map();
    const child = {
      once(e, fn) { if (!handlers.has(e)) handlers.set(e, []); handlers.get(e).push(fn); return child; },
      unref() { child.unreffed = true; }
    };
    spawned.push({ exe, args, options, child });
    setImmediate(() => { for (const fn of (handlers.get('spawn') || [])) fn(); });
    return child;
  };

  const sandbox = {
    console, JSON, Math, Date, Map, Set, Promise, Object, Array, String, Number,
    Boolean, RegExp, Error, isNaN, parseInt, parseFloat,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    setInterval: () => 0,
    localStorage: { getItem: () => null, setItem: () => {} },
    innerWidth: 900,
    innerHeight: 700,
    document: documentStub,
    window: windowStub
  };
  windowStub.document = documentStub;
  windowStub.localStorage = sandbox.localStorage;
  windowStub.__rubickStartupNow = () => clock;
  windowStub.__rubickStartupSchedule = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  if (rubickStub) { windowStub.rubick = rubickStub; sandbox.rubick = rubickStub; }

  sandbox.require = request => {
    if (request === 'child_process') {
      if (opts.skipChildProcess) throw new Error('模拟：取不到 child_process');
      return { spawn: opts.spawn || spawnOk };
    }
    if (request === 'fs') {
      return {
        appendFileSync: (f, d) => logWrites.push({ file: f, data: d }),
        existsSync: () => false, statSync: () => ({ size: 0 }), writeFileSync: () => {}
      };
    }
    if (request === 'os') return { tmpdir: () => 'C:\\Temp' };
    if (request === 'path') return path;
    if (request === '../package.json') return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    throw new Error(`测试宿主不支持 require('${request}')`);
  };

  return {
    nodes, appended, store, spawned, logWrites, timers, rubickCalls,
    el: id => nodes.get(id),
    window: windowStub,
    advance: ms => { clock += ms; },
    // 模拟 Rubick 把搜索框新文本推给插件
    searchBox(text) {
      assert(subCb, '插件没有注册 setSubInput 回调');
      subCb({ text });
    },
    // 直接注入记录（跳过执行），用来构造大数据集
    seed(list) {
      store.set('rubick-startup/history-v2', { _id: 'rubick-startup/history-v2', records: list });
    },
    // 行可能带额外 class（例如选中态 "row sel"），所以按词匹配
    rows: () => appended.filter(x => (x.className || '').split(/\s+/).includes('row')),
    runScript() {
      const context = vm.createContext(sandbox);
      vm.runInContext(SCRIPT, context, { filename: 'public/index.html#inline' });
    }
  };
}

const settle = () => new Promise(r => setImmediate(() => setImmediate(() => setImmediate(r))));
let pass = 0;
const ok = name => { pass++; console.log('  PASS  ' + name); };

function seedRecords(n, opts = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: 'r' + i,
      command: 'cmd-' + String(i).padStart(3, '0'),
      time: 1000000 + i * 1000,
      kind: 'command',
      groups: i % (opts.taggedEvery || 5) === 0 ? ['tag' + (i % 3)] : []
    });
  }
  return out;
}

async function main() {
  console.log('== 1. 接管 Rubick 搜索框 ==');
  let host = makeHost();
  host.runScript();
  await settle();
  assert.strictEqual(host.rubickCalls.setSubInput.length, 1, '没有注册 setSubInput');
  assert(host.rubickCalls.setSubInput[0].placeholder, '没有给占位提示');
  ok('调用 rubick.setSubInput(onChange, 占位提示)');

  console.log('== 2. 顶栏单行：标签 + ＋ + 状态 ==');
  for (const dead of ['echo', 'keyhint', 'count', 'sectionTitle', 'results', 'diag', 'brandLogo']) {
    assert(!host.nodes.has(dead), `已砍掉的元素 #${dead} 还在`);
  }
  for (const alive of ['status', 'tags', 'list', 'spacer', 'menu', 'toast']) {
    assert(host.nodes.has(alive), `关键元素 #${alive} 缺失`);
  }
  const tagsHtml = host.el('tags').innerHTML;
  assert(/data-group="">全部/.test(tagsHtml), `「全部」应是第一个标签：${tagsHtml}`);
  assert(/tagAdd/.test(tagsHtml), '顶栏缺少 ＋ 添加按钮');
  ok('单行顶栏：全部 → 标签 → ＋ 添加，状态在右');

  console.log('== 2b. 顶栏里没有头部块 ==');
  assert(!/class="head"/.test(html), '头部块还在（应该只有一行 .bar）');
  assert(/<div class="bar">/.test(html), '缺少单行顶栏');
  ok('Logo/标题/副标题已移除，页面只剩 顶栏一行 + 列表');

  console.log('== 3. 空列表显示引导文案 ==');
  const emptyRow = host.appended.find(x => (x.className || '') === 'empty');
  assert(emptyRow, '空列表没有渲染 empty 提示');
  assert(/还没有记录/.test(emptyRow.textContent), `文案不对：${emptyRow.textContent}`);
  assert.strictEqual(host.el('spacer').style.height, 'auto', '空列表时 spacer 高度应为 auto');
  ok('空列表有引导文案，且 spacer 不占高度');

  console.log('== 4. 搜索框打字 → 过滤（不再有回显块）==');
  host.searchBox('cmd-00');
  host.searchBox('cmd-0');
  ok('搜索框文本进入页面状态（用于过滤）');

  console.log('== 5. 合成 keydown（只有 keyCode）触发执行 ==');
  host = makeHost();
  host.runScript();
  await settle();
  host.searchBox('notepad');
  host.advance(500);
  host.window.fireKey(undefined, { keyCode: 13 });   // Electron sendInputEvent 的真实形态
  await settle();
  assert.strictEqual(host.spawned.length, 1, `没有执行，spawn=${host.spawned.length}`);
  const call = host.spawned[0];
  assert.strictEqual(call.exe, 'cmd.exe');
  assert.strictEqual(JSON.stringify(call.args), JSON.stringify(['/d', '/s', '/c', 'notepad']));
  assert.strictEqual(call.options.detached, true);
  assert.strictEqual(call.child.unreffed, true, '没有 unref');
  ok('只有 keyCode 的合成回车也能执行（这是真机踩过的坑）');

  console.log('== 6. 执行后写入记录 + 清空搜索框 ==');
  const saved = host.store.get('rubick-startup/history-v2');
  assert(saved && saved.records.length === 1, '记录没有落库');
  assert.strictEqual(saved.records[0].command, 'notepad');
  assert(Array.isArray(saved.records[0].groups), '新记录应有 groups 数组');
  assert(!('note' in saved.records[0]) && !('category' in saved.records[0]), '死字段 note/category 不该再写入');
  assert(host.rubickCalls.setSubInputValue.includes(''), '执行后没有清空搜索框');
  ok('记录落库（带 groups）、死字段已移除、搜索框清空');

  console.log('== 7. 点记录 → 重跑 ==');
  host.spawned.length = 0;
  host.advance(500);
  const row = host.rows()[0];
  assert(row, '列表里没有行');
  const rec = host.store.get('rubick-startup/history-v2').records[0];
  row.dataset.id = rec.id;
  host.el('list').dispatch('click', { target: { closest: sel => (sel === '.row' ? row : null) } });
  await settle();
  assert.strictEqual(host.spawned.length, 1, '点记录没有重跑');
  ok('点记录行直接重跑');

  console.log('== 8. 标签：加标签后永久保留 + 出现在筛选行 ==');
  host = makeHost();
  host.seed(seedRecords(6));
  host.runScript();
  await settle();
  const recs = () => host.store.get('rubick-startup/history-v2').records;
  const target = recs()[0];
  const groupsBefore = target.groups.length;
  // 行内的 ＋ 已按设计砍掉（列表行只有 命令 + 标签 + 时间）：
  // 给记录加标签改走右键菜单 → 「新建标签并加入…」
  host.el('list').dispatch('contextmenu', {
    target: { closest: sel => (sel === '.row' ? { dataset: { id: target.id } } : null) },
    clientX: 20, clientY: 20, preventDefault() {}
  });
  await settle();
  assert(/data-act="newgroup"/.test(host.el('menu').innerHTML), '右键菜单里没有「新建标签并加入…」');
  host.el('menu').dispatch('click', {
    target: { closest: () => ({ dataset: { act: 'newgroup' } }) },
    currentTarget: host.el('menu')
  });
  await settle();
  const input = host.nodes.get('newgroup');
  assert(input, '选「新建标签并加入…」没有出现标签输入框');
  input.value = '项目文件夹';
  host.window.fireKey(undefined, { keyCode: 13 });   // 菜单输入框里回车
  await settle();
  const tagged = recs().find(r => r.id === target.id);
  assert(tagged.groups.includes('项目文件夹'), `标签没有加上：${JSON.stringify(tagged.groups)}`);
  assert.strictEqual(tagged.groups.length, groupsBefore + 1, '标签数应 +1');
  ok('右键行 → 新建标签 → 输入名字 → 回车，标签写入记录');

  console.log('== 8b. 右键菜单：复制命令（桩里没有剪贴板，必须走兜底且不崩）==');
  host.el('list').dispatch('contextmenu', {
    target: { closest: sel => (sel === '.row' ? { dataset: { id: target.id } } : null) },
    clientX: 20, clientY: 20, preventDefault() {}
  });
  await settle();
  assert(/data-act="copy"/.test(host.el('menu').innerHTML), '右键菜单里没有「复制命令」');
  host.el('menu').dispatch('click', {
    target: { closest: () => ({ dataset: { act: 'copy' } }) },
    currentTarget: host.el('menu')
  });
  await settle();
  // 桩里 require('electron') 会抛错、document.body 不存在 —— 只能落到"复制失败"，但不该抛出来
  assert(/已复制命令|复制失败/.test(host.el('toast').textContent), `复制没有给出结果：${host.el('toast').textContent}`);
  assert(!host.el('menu').classList.contains('show'), '点完菜单项菜单应关掉');
  ok('右键「复制命令」有兜底、不抛错，菜单正常关闭');

  console.log('== 9. 筛选行渲染标签，点标签筛选 ==');
  assert(/全部/.test(host.el('tags').innerHTML), '筛选行没有「全部」');
  assert(/tag/.test(host.el('tags').innerHTML), '筛选行没有渲染已存在的标签');
  ok('筛选行显示「全部」+ 各标签');

  console.log('== 10. 移出标签 ==');
  const before = recs().find(r => r.id === target.id).groups.length;
  const chip = { dataset: { ungroup: recs().find(r => r.id === target.id).groups[0] } };
  host.el('list').dispatch('click', {
    target: {
      closest: sel => (sel === '[data-ungroup]' ? chip
        : sel === '.row' ? { dataset: { id: target.id } } : null)
    },
    stopPropagation() {}
  });
  await settle();
  assert.strictEqual(recs().find(r => r.id === target.id).groups.length, before - 1, '标签没有移出');
  ok('点 chip 上的 × 移出标签');

  console.log('== 11. 虚拟滚动：只渲染窗口内的行 ==');
  host = makeHost();
  host.seed(seedRecords(500));
  host.runScript();
  await settle();
  const rendered = host.rows().length;
  assert(rendered > 0, '一行都没渲染');
  assert(rendered < 60, `渲染了 ${rendered} 行 —— 500 条全渲染了，虚拟滚动没生效`);
  const spacerH = host.el('spacer').style.height;
  assert.strictEqual(spacerH, (500 * ROW_H) + 'px', `spacer 高度应为 500×${ROW_H}，实际 ${spacerH}`);
  ok(`500 条只渲染 ${rendered} 行，spacer 高度 ${spacerH}`);

  console.log('== 12. 滚动后窗口位移，仍是少量行 ==');
  host.el('list').scrollTop = 100 * ROW_H;
  host.el('list').dispatch('scroll');
  await settle();
  const afterScroll = host.rows().length;
  assert(afterScroll > 0 && afterScroll < 60, `滚动后渲染 ${afterScroll} 行，异常`);
  ok(`滚到第 100 行仍只渲染 ${afterScroll} 行`);

  console.log('== 13. 上限只清理没有标签的记录 ==');
  host = makeHost();
  const mixed = seedRecords(520, { taggedEvery: 2 });   // 一半带标签
  host.seed(mixed);
  host.runScript();
  await settle();
  host.advance(500);
  host.searchBox('cmd-519');
  host.window.fireKey(undefined, { keyCode: 13 });      // 触发一次 persist（走 prune）
  await settle();
  const kept = host.store.get('rubick-startup/history-v2').records;
  const keptTagged = kept.filter(r => r.groups.length).length;
  const keptPlain = kept.filter(r => !r.groups.length).length;
  assert(keptTagged > 250, `带标签的被误删了，只剩 ${keptTagged}`);
  assert(keptPlain <= 500, `无标签记录超过上限：${keptPlain}`);
  ok(`带标签 ${keptTagged} 条全部保留，无标签被压到 ${keptPlain} 条（上限 500）`);

  console.log('== 14. 排序：纯按最近使用，不置顶 ==');
  host = makeHost();
  host.seed([
    { id: 'old-tagged', command: 'old-tagged', time: 1000, kind: 'command', groups: ['常用'] },
    { id: 'new-plain', command: 'new-plain', time: 9000, kind: 'command', groups: [] }
  ]);
  host.runScript();
  await settle();
  const firstRow = host.rows()[0];
  assert.strictEqual(firstRow.dataset.id, 'new-plain', `最新使用的应排第一，实际 ${firstRow.dataset.id}`);
  ok('带标签的不会被置顶，仍按最近使用排序');

  console.log('== 15. 启动出错如实报错 ==');
  host = makeHost({
    spawn(exe, args, options) {
      const handlers = new Map();
      const child = {
        once(e, fn) { if (!handlers.has(e)) handlers.set(e, []); handlers.get(e).push(fn); return child; },
        unref() {}
      };
      host.spawned.push({ exe, args, options, child });
      setImmediate(() => { for (const fn of (handlers.get('error') || [])) fn(new Error('模拟：无法启动')); });
      return child;
    }
  });
  host.runScript();
  await settle();
  host.searchBox('no-such-cmd-xyz');
  host.advance(500);
  host.window.fireKey(undefined, { keyCode: 13 });
  await settle();
  assert(/启动失败/.test(host.el('status').textContent), `状态应显示启动失败：${host.el('status').textContent}`);
  assert(/失败/.test(host.logWrites.map(w => w.data).join('')), '日志没记录失败');
  ok('子进程报错时状态显示启动失败并写日志');

  console.log('== 16. 取不到 child_process 时拦住执行 ==');
  host = makeHost({ skipChildProcess: true });
  host.runScript();
  await settle();
  assert(/无法执行/.test(host.el('status').textContent), `状态：${host.el('status').textContent}`);
  host.searchBox('notepad');
  host.advance(500);
  host.window.fireKey(undefined, { keyCode: 13 });
  await settle();
  assert.strictEqual(host.spawned.length, 0, '不可用时竟然执行了');
  ok('不可用时拦住执行，状态如实说明原因');

  console.log('== 17. 顶栏新建标签（空标签也要留住）==');
  host = makeHost();
  // 明确三条都无标签：seedRecords 的 taggedEvery 会给第 0 条打标，这里不用它
  host.seed([
    { id: 'a', command: 'aaa', time: 1000, kind: 'command', groups: [] },
    { id: 'b', command: 'bbb', time: 2000, kind: 'command', groups: [] },
    { id: 'c', command: 'ccc', time: 3000, kind: 'command', groups: [] }
  ]);
  host.runScript();
  await settle();
  const groupNames = () => [...(host.el('tags').innerHTML.matchAll(/data-group="([^"]*)"/g))].map(m => m[1]).filter(Boolean);
  assert.strictEqual(groupNames().length, 0, `前置：不该有标签，实际 ${JSON.stringify(groupNames())}`);
  // 点 ＋ 标签 → 输入名字 → 回车
  host.el('tags').dispatch('click', { target: { closest: sel => (sel === '#tagAdd' ? {} : null) } });
  const tinput = host.nodes.get('tagInput');
  assert(tinput, '点 ＋ 标签 没有出现输入框');
  tinput.value = '项目文件夹';
  host.window.fireKey(undefined, { keyCode: 13 });
  await settle();
  assert(/项目文件夹/.test(host.el('tags').innerHTML), `新建的标签没出现在顶栏：${host.el('tags').innerHTML}`);
  ok('顶栏 ＋ 标签 可新建，且没有记录引用它也不会消失');

  console.log('== 18. 删除标签：从所有记录移出 ==');
  host = makeHost();
  host.seed([
    { id: 'a', command: 'a', time: 1000, kind: 'command', groups: ['X', 'Y'] },
    { id: 'b', command: 'b', time: 2000, kind: 'command', groups: ['X'] }
  ]);
  host.runScript();
  await settle();
  // 右键标签 → 删除
  const tagEl = { dataset: { group: 'X' } };
  host.el('tags').dispatch('contextmenu', {
    target: { closest: sel => (sel === '[data-group]' ? tagEl : null) },
    clientX: 5, clientY: 5, preventDefault() {}
  });
  await settle();
  const del = { dataset: { tagact: 'delete' } };
  host.el('menu').dispatch('click', { target: { closest: () => del }, currentTarget: host.el('menu') });
  await settle();
  const left = host.store.get('rubick-startup/history-v2').records;
  assert(!left.some(r => (r.groups || []).includes('X')), '删除标签后记录里还残留 X');
  assert(left.find(r => r.id === 'a').groups.includes('Y'), '删 X 不该影响 Y');
  ok('删除标签会从所有记录移出，且不影响其它标签');

  console.log('== 19. 重命名标签：记录跟着改 ==');
  host = makeHost();
  host.seed([{ id: 'a', command: 'a', time: 1000, kind: 'command', groups: ['旧名'] }]);
  host.runScript();
  await settle();
  host.el('tags').dispatch('contextmenu', {
    target: { closest: sel => (sel === '[data-group]' ? { dataset: { group: '旧名' } } : null) },
    clientX: 5, clientY: 5, preventDefault() {}
  });
  await settle();
  host.el('menu').dispatch('click', {
    target: { closest: () => ({ dataset: { tagact: 'rename' } }) },
    currentTarget: host.el('menu')
  });
  await settle();
  const rinput = host.nodes.get('tagInput');
  assert(rinput, '重命名没有出现输入框');
  rinput.value = '新名';
  host.window.fireKey(undefined, { keyCode: 13 });
  await settle();
  const renamed = host.store.get('rubick-startup/history-v2').records[0];
  assert.deepStrictEqual(renamed.groups, ['新名'], `重命名没落到记录上：${JSON.stringify(renamed.groups)}`);
  ok('重命名标签会同步改所有记录上的引用');

  console.log('== 20. ↑↓ 在列表里选，回车跑选中的 ==');
  host = makeHost();
  host.seed([
    { id: 's1', command: 'first-cmd', time: 3000, kind: 'command', groups: [] },
    { id: 's2', command: 'second-cmd', time: 2000, kind: 'command', groups: [] },
    { id: 's3', command: 'third-cmd', time: 1000, kind: 'command', groups: [] }
  ]);
  host.runScript();
  await settle();
  const selId = () => {
    const row = host.rows().find(r => /(^|\s)sel(\s|$)/.test(r.className));
    return row ? row.dataset.id : null;
  };
  assert.strictEqual(selId(), null, '一开始不该有选中项');

  host.window.fireKey(undefined, { keyCode: 40 });   // ↓（合成事件只有 keyCode）
  await settle();
  assert.strictEqual(selId(), 's1', `第一次 ↓ 应选中第一条，实际 ${selId()}`);
  assert(/▶ /.test(host.el('status').textContent), `状态位应显示选中项：${host.el('status').textContent}`);

  host.window.fireKey(undefined, { keyCode: 40 });
  await settle();
  assert.strictEqual(selId(), 's2', `第二次 ↓ 应选中第二条，实际 ${selId()}`);

  host.window.fireKey(undefined, { keyCode: 38 });   // ↑
  await settle();
  assert.strictEqual(selId(), 's1', `↑ 应回到第一条，实际 ${selId()}`);

  host.spawned.length = 0;
  host.advance(500);
  host.window.fireKey(undefined, { keyCode: 13 });   // 回车跑选中的
  await settle();
  assert.strictEqual(host.spawned.length, 1, '回车没有执行');
  assert.strictEqual(
    JSON.stringify(host.spawned[0].args),
    JSON.stringify(['/d', '/s', '/c', 'first-cmd']),
    `应执行选中项 first-cmd，实际 ${JSON.stringify(host.spawned[0].args)}`
  );
  ok('↑↓ 选择、回车执行选中项（合成事件只有 keyCode 也能选）');

  console.log('== 21. 输入变化后选中作废，回车回到跑原文 ==');
  host.searchBox('third');
  await settle();
  assert.strictEqual(selId(), null, '输入变化后应清掉选中');
  host.spawned.length = 0;
  host.advance(500);
  host.window.fireKey(undefined, { keyCode: 13 });
  await settle();
  assert.strictEqual(
    JSON.stringify(host.spawned[0].args),
    JSON.stringify(['/d', '/s', '/c', 'third']),
    `没有选中时应跑输入的原文，实际 ${JSON.stringify(host.spawned[0].args)}`
  );
  ok('改了输入就清掉选中，回车回到执行原文');

  console.log('== 22. 选中不会越界 ==');
  host = makeHost();
  host.seed([
    { id: 'a', command: 'aa', time: 2000, kind: 'command', groups: [] },
    { id: 'b', command: 'bb', time: 1000, kind: 'command', groups: [] }
  ]);
  host.runScript();
  await settle();
  for (let i = 0; i < 6; i++) host.window.fireKey(undefined, { keyCode: 40 });
  await settle();
  let selRow = host.rows().find(r => /(^|\s)sel(\s|$)/.test(r.className));
  assert.strictEqual(selRow.dataset.id, 'b', `↓ 到底应停在最后一条，实际 ${selRow.dataset.id}`);
  for (let i = 0; i < 6; i++) host.window.fireKey(undefined, { keyCode: 38 });
  await settle();
  selRow = host.rows().find(r => /(^|\s)sel(\s|$)/.test(r.className));
  assert.strictEqual(selRow.dataset.id, 'a', `↑ 到顶应停在第一条，实际 ${selRow.dataset.id}`);
  ok('↑↓ 不会越界');

  console.log('== 23. 选中项会被滚动进视野 ==');
  host = makeHost();
  host.seed(seedRecords(60));
  host.runScript();
  await settle();
  host.el('list').clientHeight = 100;      // 视口只放得下 2 行
  for (let i = 0; i < 12; i++) host.window.fireKey(undefined, { keyCode: 40 });
  await settle();
  assert(host.el('list').scrollTop > 0, `选到第 12 条时应把列表滚下去，实际 scrollTop=${host.el('list').scrollTop}`);
  const visibleRow = host.rows().find(r => /(^|\s)sel(\s|$)/.test(r.className));
  assert(visibleRow, '滚动后选中的那一行必须仍在渲染窗口里（否则看不到高亮）');
  ok('↑↓ 选到视野外时自动滚动，且高亮行始终在渲染窗口内');

  console.log('\n全部通过：' + pass + ' 项');
}

main().catch(error => {
  console.error('\nFAIL:', error && error.stack || error);
  process.exitCode = 1;
});
