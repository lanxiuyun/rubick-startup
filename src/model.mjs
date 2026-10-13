export const KEY = 'rubick-startup/history-v2';
export const LIMIT = 500;
export const ROW_H = 56;
export const groupsOf = record => Array.isArray(record.groups) ? record.groups : [];
export const normalizePath = text => {
  const path = String(text).replace(/\//g, '\\');
  return path.startsWith('\\\\') ? `\\\\${path.slice(2).replace(/^\\+/, '').replace(/\\+/g, '\\')}` : path.replace(/\\+/g, '\\');
};
export const guessKind = text => /^[a-z][a-z0-9+.-]*:\/\//i.test(text.trim()) ? 'url'
  : /^[a-zA-Z]:[\\/]|^\\\\|^\.\.?[\\/]/.test(text.trim()) ? 'path' : 'command';

export function fuzzy(text, query) {
  const value = String(text || '').toLocaleLowerCase();
  const needle = query.toLocaleLowerCase().trim();
  if (!needle) return 1;
  if (value.includes(needle)) return 100 - needle.length;
  let cursor = 0, start = -1, gap = 0, previous = -1;
  for (const character of needle) {
    const index = value.indexOf(character, cursor);
    if (index < 0) return 0;
    if (start < 0) start = index;
    if (previous >= 0) gap += index - previous - 1;
    previous = index;
    cursor = index + 1;
  }
  return Math.max(1, 65 - start - gap);
}

export function visible(records, query = '', group = '') {
  return records.filter(record => (!group || groupsOf(record).includes(group)) &&
    Math.max(fuzzy(record.command, query), ...groupsOf(record).map(tag => fuzzy(tag, query))) > 0)
    .sort((a, b) => b.time - a.time);
}

export function prune(records) {
  const sorted = [...records].sort((a, b) => b.time - a.time);
  let plain = 0;
  return sorted.filter(record => groupsOf(record).length || plain++ < LIMIT);
}

export function groupCounts(records, pinned = []) {
  const counts = new Map();
  records.forEach(record => groupsOf(record).forEach(group => counts.set(group, (counts.get(group) || 0) + 1)));
  pinned.forEach(group => { if (!counts.has(group)) counts.set(group, 0); });
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function keyName(event) {
  if (event.key === 'Enter' || event.key === 'Return' || event.code === 'Enter' || event.code === 'NumpadEnter' || event.keyCode === 13 || event.which === 13) return 'enter';
  if (event.key === 'ArrowDown' || event.key === 'Down' || event.code === 'ArrowDown' || event.keyCode === 40 || event.which === 40) return 'down';
  if (event.key === 'ArrowUp' || event.key === 'Up' || event.code === 'ArrowUp' || event.keyCode === 38 || event.which === 38) return 'up';
  if (event.key === 'Escape' || event.code === 'Escape' || event.keyCode === 27) return 'escape';
  return '';
}

export function nextSelection(index, delta, count) {
  if (!count) return -1;
  return index < 0 ? (delta > 0 ? 0 : count - 1) : Math.max(0, Math.min(count - 1, index + delta));
}
