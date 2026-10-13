import { KEY, groupCounts } from './model.mjs';

export type RecordItem = { id: string; command: string; time: number; kind: string; groups: string[] };
type Document = { _id?: string; _rev?: string; records: RecordItem[]; groups?: string[] };
type Rubick = {
  db: { get: (key: string) => Document | null; put: (doc: Document) => unknown };
  setSubInput: (callback: (data: { text?: string } | string) => void, placeholder: string, focus: boolean) => void;
  setSubInputValue: (value: string) => void;
  onPluginReady: (callback: () => void) => void;
  setExpendHeight: (height: number) => void;
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
let fs: any, logPath: string;
try {
  fs = window.require?.('fs');
  logPath = window.require?.('path').join(window.require?.('os').tmpdir(), 'rubick-startup.log');
  if (fs && fs.existsSync(logPath) && fs.statSync(logPath).size > 256 * 1024) fs.writeFileSync(logPath, '');
} catch { /* Logging must not prevent opening the plugin. */ }
export function log(kind: string, text: string) {
  console.info('[rubick-startup]', kind, text);
  try { fs?.appendFileSync(logPath, `${new Date(now()).toISOString()} [${kind}] ${text}\n`); } catch { /* Best effort. */ }
}
log('session', '打开 React 插件');
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
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      log('run', error ? `失败：${error.message}` : `已启动：${command.slice(0, 160)}`);
      if (error) reject(error); else resolve();
    };
    try {
      const spawn = window.require?.('child_process').spawn;
      if (!spawn) throw new Error('页面没有 child_process，无法执行命令');
      const child = spawn('cmd.exe', ['/d', '/s', '/c', command], { detached: true, windowsHide: true, stdio: 'ignore' });
      child.once('error', (error: Error) => finish(error));
      child.once('spawn', () => { finish(); child.unref(); });
      schedule(() => finish(new Error('启动请求超时')), 2500);
    } catch (error) { finish(error as Error); }
  });
}
