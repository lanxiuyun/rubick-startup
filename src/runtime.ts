import { KEY, groupCounts } from './model.mjs';

export type RecordItem = { id: string; command: string; time: number; kind: string; groups: string[] };
type Document = { _id?: string; _rev?: string; records: RecordItem[]; groups?: string[] };
type Rubick = {
  db: { get: (key: string) => Document | null; put: (doc: Document) => unknown };
  setSubInput: (callback: (data: { text?: string } | string) => void, placeholder: string, focus: boolean) => void;
  setSubInputValue: (value: string) => void;
  onPluginReady: (callback: () => void) => void;
  setExpendHeight: (height: number) => void;
  outPlugin: () => void;
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
const schedule = window.__rubickStartupSchedule ?? setTimeout;
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
log('session', '打开 React 插件；执行诊断版本 2026-10-13.1');
try {
  const process = window.require?.('process');
  log('environment', JSON.stringify({ pid: process?.pid, execPath: process?.execPath, cwd: process?.cwd(), versions: process?.versions, logPath }));
} catch (error) { log('environment', String(error)); }
export function load(): RecordItem[] {
  try { const doc = rubick?.db.get(KEY); if (Array.isArray(doc?.records)) return doc.records; } catch { /* Fall back to browser storage. */ }
  try { const data = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(data)) return data; if (Array.isArray(data?.records)) return data.records; } catch { /* Empty store. */ }
  return [];
}
export function loadGroups(records: RecordItem[]): string[] {
  let groups: string[] = [];
  try {
    const doc = rubick?.db ? rubick.db.get(KEY) : JSON.parse(localStorage.getItem(KEY) || 'null');
    if (Array.isArray(doc?.groups)) groups = doc.groups.filter((group: unknown): group is string => typeof group === 'string');
  } catch { /* Legacy data has no independent tag list. */ }
  return groupCounts(records, groups).map(([group]: [string, number]) => group);
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
      const target = command.startsWith('"') && command.endsWith('"') ? command.slice(1, -1) : command;
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
        const spawn = window.require?.('child_process').spawn;
        if (!spawn) throw new Error('页面没有 child_process，无法执行命令');
        const args = ['/d', '/s', '/u', '/c', command];
        trace('cmd-request', { args });
        const child = spawn('cmd.exe', args, { detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        child.once('spawn', () => trace('cmd-spawn', { pid: child.pid }));
        const chunks: Uint8Array[] = [];
        let size = 0;
        child.stderr.on('data', (chunk: Uint8Array) => {
          if (size >= 64 * 1024) return;
          const part = chunk.subarray(0, 64 * 1024 - size);
          chunks.push(part); size += part.length;
        });
        child.once('error', (error: Error) => finish(error));
        child.once('close', (code: number | null, signal: string | null) => {
          trace('cmd-close', { code, signal, stderrBytes: size });
          child.unref();
          if (code === 0) { finish(); return; }
          const bytes = new Uint8Array(size);
          let offset = 0;
          chunks.forEach(chunk => { bytes.set(chunk, offset); offset += chunk.length; });
          // cmd /u emits UTF-16LE; external programs can still emit UTF-8 or the Windows code page.
          const unicode = bytes.some((byte, index) => index % 2 === 1 && byte === 0);
          let detail = new TextDecoder(unicode ? 'utf-16le' : 'utf-8').decode(bytes);
          if (!unicode && detail.includes('\uFFFD')) detail = new TextDecoder('gb18030').decode(bytes);
          finish(new Error(detail.trim() || `命令退出码：${code ?? signal ?? '未知'}`));
        });
      }
    } catch (error) { finish(error as Error); }
  });
}
