import { KEY, groupCounts, guessKind, normalizePath } from './model.mjs';

export type RecordItem = { id: string; command: string; time: number; kind: string; groups: string[] };
type Document = { _id?: string; _rev?: string; records: RecordItem[]; groups?: string[] };
type Rubick = {
  db: { get: (key: string) => Document | null; put: (doc: Document) => unknown };
  setSubInput: (callback: (data: { text?: string } | string) => void, placeholder: string, focus: boolean) => void;
  setSubInputValue: (value: string) => void;
  onPluginReady: (callback: () => void) => void;
  setExpendHeight: (height: number) => void;
  outPlugin: () => void;
  hideMainWindow: () => void;
};
declare global {
  interface Window {
    rubick?: Rubick;
    require?: (name: string) => any;
    __rubickStartupNow?: () => number;
    __rubickStartupSchedule?: typeof setTimeout;
  }
}
export const rubick = window.rubick;
export const now = () => window.__rubickStartupNow?.() ?? Date.now();
let hostContents: any;
let pauseEscape: (() => () => void) | undefined;
let hostBridgeStage = 'load-remote';
let hostBridgeError = '';
let hostBridgeIds: { host?: number; plugin?: number } = {};
const escapeCycle = { current: 0 };
try {
  let remote: any;
  try { remote = window.require?.('@electron/remote'); }
  catch {
    const resources = window.require?.('process').resourcesPath;
    if (resources) remote = window.require?.(window.require?.('path').join(resources, 'app.asar', 'node_modules', '@electron', 'remote'));
  }
  hostBridgeStage = 'get-host-window';
  hostContents = remote?.getCurrentWindow().webContents;
  if (hostContents) {
    hostBridgeIds.host = hostContents.id;
    hostBridgeStage = 'create-escape-handler';
    const fs = remote.require('fs'), path = remote.require('path'), os = remote.require('os');
    const suspend = remote.require('vm').runInThisContext(`(contents, pluginContents, fs, path, os) => {
      const trace = (stage, data) => fs.appendFileSync(path.join(os.tmpdir(), 'rubick-startup.log'),
        new Date().toISOString() + ' [input-escape-main] ' + JSON.stringify({ stage, host: contents.id, plugin: pluginContents.id, ...data }) + '\\n');
      const allListeners = contents.listeners('before-input-event');
      const listenerInfo = allListeners.map((listener, index) => ({ index, name: listener.name, source: listener.toString().slice(0, 500) }));
      const listeners = allListeners.filter(listener => listener.toString().includes('__EscapeKeyDown'));
      const pluginListeners = pluginContents.listeners('before-input-event').filter(listener => listener.toString().includes('__EscapeKeyDown'));
      trace('menu-open', { total: allListeners.length, matched: listeners.length, pluginMatched: pluginListeners.length, listeners: listenerInfo });
      for (const listener of listeners) contents.removeListener('before-input-event', listener);
      for (const listener of pluginListeners) pluginContents.removeListener('before-input-event', listener);
      const forwardEscape = (event, input) => {
        if (!input || input.key !== 'Escape' || input.control || input.meta || input.shift || input.alt) return;
        trace('escape-received', { input: { type: input.type, key: input.key, code: input.code, keyCode: input.keyCode, control: input.control, meta: input.meta, shift: input.shift, alt: input.alt }, defaultPrevented: event.defaultPrevented });
        event.preventDefault();
        const destroyed = pluginContents.isDestroyed();
        if (!destroyed) pluginContents.sendInputEvent({ type: input.type, keyCode: 'Escape' });
        trace('escape-forwarded', { destroyed, defaultPrevented: event.defaultPrevented });
      };
      contents.on('before-input-event', forwardEscape);
      let restored = false;
      const restore = () => {
        if (restored) return true;
        restored = true;
        contents.removeListener('before-input-event', forwardEscape);
        for (const listener of listeners) contents.on('before-input-event', listener);
        if (!pluginContents.isDestroyed()) {
          for (const listener of pluginListeners) pluginContents.on('before-input-event', listener);
        }
        trace('menu-close', { remaining: contents.listenerCount('before-input-event'), restored: listeners.length, pluginRestored: !pluginContents.isDestroyed() ? pluginListeners.length : 0 });
        pluginContents.removeListener('destroyed', restore);
        return true;
      };
      pluginContents.once('destroyed', restore);
      return { total: allListeners.length, listenerInfo, matched: listeners.length, restore };
    }`);
    hostBridgeStage = 'get-plugin-contents';
    const pluginContents = remote.getCurrentWebContents();
    hostBridgeIds.plugin = pluginContents.id;
    pauseEscape = () => {
      const result = suspend(hostContents, pluginContents, fs, path, os);
      const cycle = ++escapeCycle.current;
      log('input-escape-listeners', JSON.stringify({ cycle, total: result.total, matched: result.matched, listeners: result.listenerInfo, ...hostBridgeIds }));
      return () => {
        result.restore();
        log('input-escape-restored', JSON.stringify({ cycle, ...hostBridgeIds }));
      };
    };
    hostBridgeStage = 'ready';
  }
} catch (error) { hostBridgeError = String(error); }
export function focusHostInput() {
  try {
    hostContents?.focus();
    void hostContents?.executeJavaScript("(() => { const input = document.querySelector('.rubick-select input, input'); input?.focus(); return !!input && document.activeElement === input; })()").then((focused: boolean) => logInputState('input-focus-result', { focused }), (error: Error) => log('input-focus', String(error)));
  } catch (error) { log('input-focus', String(error)); }
}
export function suspendHostEscape() {
  // Rubick 4.3.8 exits in before-input-event, before the plugin can consume Escape.
  log('input-escape-install', JSON.stringify({ time: new Date(now()).toISOString(), available: !!pauseEscape, stage: hostBridgeStage, error: hostBridgeError, ...hostBridgeIds }));
  try { return pauseEscape?.() ?? (() => {}); }
  catch (error) { log('input-escape', String(error)); return () => {}; }
}
let fs: any, logPath = '';
try {
  fs = window.require?.('fs');
  logPath = window.require?.('path').join(window.require?.('os').tmpdir(), 'rubick-startup.log');
  if (fs && fs.existsSync(logPath) && fs.statSync(logPath).size > 256 * 1024) fs.writeFileSync(logPath, '');
} catch { /* Logging must not prevent opening the plugin. */ }
export function log(kind: string, text: string) {
  console.info('[rubick-startup]', kind, text);
  try { fs?.appendFileSync(logPath, `${new Date(now()).toISOString()} [${kind}] ${text}\n`); } catch (error) { console.warn('[rubick-startup] 文件日志写入失败', error); }
}
export function logInputState(kind: string, data: object = {}) {
  log(kind, JSON.stringify({ time: new Date(now()).toISOString(), ...data }));
}
log('session', '打开 React 插件；双 webContents Esc 监听修复版本 2026-10-14.3');
log('input-host-bridge', JSON.stringify({ stage: hostBridgeStage, error: hostBridgeError, ...hostBridgeIds }));
try {
  const process = window.require?.('process');
  log('environment', JSON.stringify({ pid: process?.pid, execPath: process?.execPath, cwd: process?.cwd(), versions: process?.versions, logPath }));
} catch (error) { log('environment', String(error)); }
export function loadStore(): { records: RecordItem[]; pinned: string[] } {
  let records: RecordItem[] = [], groups: string[] = [], loaded = false;
  try {
    const doc = rubick?.db.get(KEY);
    if (Array.isArray(doc?.records)) { records = doc.records; loaded = true; }
    if (Array.isArray(doc?.groups)) groups = doc.groups.filter((group: unknown): group is string => typeof group === 'string');
  } catch { /* Fall back to browser storage. */ }
  if (!loaded) {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (Array.isArray(data)) records = data;
      else if (Array.isArray(data?.records)) { records = data.records; groups = Array.isArray(data.groups) ? data.groups : []; }
    } catch { /* Empty store. */ }
  }
  return { records, pinned: groupCounts(records, groups).map(([group]) => group) };
}
export function save(records: RecordItem[], groups: string[]) {
  if (rubick?.db) {
    const old = rubick.db.get(KEY);
    rubick.db.put({ _id: KEY, ...(old?._rev ? { _rev: old._rev } : {}), records, groups });
  } else localStorage.setItem(KEY, JSON.stringify({ records, groups }));
}
export async function copy(text: string) {
  try { const clipboard = window.require?.('electron').clipboard; if (clipboard) { clipboard.writeText(text); return; } } catch { /* Use browser clipboard. */ }
  await navigator.clipboard.writeText(text);
}
export function spawnCommand(command: string): Promise<void> {
  const started = now();
  const id = `${started}-${Math.random().toString(36).slice(2, 7)}`;
  const trace = (stage: string, data: object = {}) => log('execution', JSON.stringify({ id, stage, elapsedMs: now() - started, ...data }));
  trace('request', { command });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      trace('result', { success: !error, error: error?.message });
      log('run', error ? `失败：${error.message}` : `已启动：${command.slice(0, 160)}`);
      if (error) reject(error); else resolve();
    };
    try {
      const rawTarget = command.startsWith('"') && command.endsWith('"') ? command.slice(1, -1) : command;
      const target = guessKind(rawTarget) === 'path' ? normalizePath(rawTarget) : rawTarget;
      let directory = false;
      try {
        directory = fs?.statSync(target).isDirectory() ?? false;
        trace('stat', { target, directory, fsAvailable: !!fs });
      } catch (error) {
        trace('stat-error', { target, code: (error as { code?: string }).code, error: (error as Error).message });
      }
      if (directory) {
        const spawn = window.require?.('child_process').spawn;
        if (!spawn) throw new Error('页面没有 child_process，无法打开文件夹');
        trace('explorer-request', { target });
        const child = spawn('explorer.exe', [target], { detached: true, windowsHide: false, stdio: 'ignore' });
        child.once('error', (error: Error) => { trace('explorer-error', { error: error.message }); finish(error); });
        child.once('spawn', () => {
          trace('explorer-spawn', { pid: child.pid });
          child.unref();
          finish();
        });
      } else {
        const childProcess = window.require?.('child_process');
        if (!childProcess?.spawn) throw new Error('页面没有 child_process，无法执行命令');
        const entry = /^\s*(?:"([^"]+)"|([^\s&|<>]+))/.exec(command);
        if (!entry) throw new Error('无法识别命令入口');
        const executable = entry[1] || entry[2];
        const builtin = /^(assoc|break|call|cd|chdir|cls|color|copy|date|del|dir|echo|endlocal|erase|exit|for|ftype|goto|if|md|mkdir|mklink|move|path|pause|popd|prompt|pushd|rd|rem|ren|rename|rmdir|set|setlocal|shift|start|time|title|type|ver|verify|vol)$/i.test(executable) || /^[a-z]:$/i.test(executable);
        if (!builtin) {
          if (/["&|<>^%!*?()]/.test(executable)) throw new Error('无法识别命令入口');
          let found = false;
          if (/[\\/:]/.test(executable)) {
            try { found = fs?.statSync(normalizePath(executable)).isFile() ?? false; } catch { /* Missing executable. */ }
          } else {
            const lookup = childProcess.spawnSync('where.exe', [executable], { encoding: 'utf8', windowsHide: true, timeout: 2500 });
            trace('where-result', { executable, found: lookup.status === 0, error: lookup.error?.message });
            if (lookup.error) throw lookup.error;
            found = lookup.status === 0;
          }
          if (!found) throw new Error(`命令不存在或不可访问：${executable}`);
        }
        const args = ['/d', '/s', '/u', '/k', command];
        trace('interactive-command-request', { args });
        const child = childProcess.spawn('cmd.exe', args, { detached: true, windowsHide: false, stdio: 'ignore' });
        child.once('error', (error: Error) => finish(error));
        child.once('spawn', () => {
          trace('interactive-command-spawn', { pid: child.pid });
          child.unref();
          finish();
        });
      }
    } catch (error) { finish(error as Error); }
  });
}
