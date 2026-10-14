import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { App, Badge, Button, Dropdown, Empty, Input, Popover, Space, Tag, Tooltip } from 'antd';
import { CheckOutlined, CloseOutlined, CodeOutlined, DeleteOutlined, EditOutlined, FolderOutlined, PlusOutlined } from '@ant-design/icons';
import { RecordTagPanel } from './RecordTagPanel';
import { groupCounts, groupsOf, guessKind, INPUT_ROW_ID, keyName, listRows, nextSelection, prune, ROW_H, visible } from './model.mjs';
import { copy, focusHostInput, loadStore, log, logInputState, now, rubick, save, spawnCommand, suspendHostEscape, type RecordItem } from './runtime';

type State = { records: RecordItem[]; query: string; group: string; selected: string | null; pinned: string[] };
type Editor = { mode: 'create' | 'rename'; name: string };
const ERROR_GROUP = 'error';

function initialState(): State {
  const { records, pinned } = loadStore();
  return { records, query: '', group: '', selected: visible(records)[0]?.id ?? null, pinned };
}

export function StartupApp() {
  const { message } = App.useApp();
  const [state, setState] = useState(initialState);
  const current = useRef(state);
  const [editor, setEditor] = useState<Editor | null>(null);
  const editing = useRef(editor);
  editing.current = editor;
  const [name, setName] = useState('');
  const [tagMenu, setTagMenu] = useState<string | null>(null);
  const tagMenuOpen = useRef(false);
  tagMenuOpen.current = tagMenu !== null;
  const [panel, setPanel] = useState<{ id: string; x: number; y: number; groups: string[] } | null>(null);
  const panelOpen = useRef(false);
  const escapeHeld = useRef(false);
  const [awaitEscapeRelease, setAwaitEscapeRelease] = useState(false);
  panelOpen.current = !!panel;
  const panelRecord = state.records.find(record => record.id === panel?.id);
  const [viewport, setViewport] = useState({ width: innerWidth, height: innerHeight });
  const panelListHeight = Math.max(36, Math.min(200, viewport.height - 180));
  const panelHeight = panelListHeight + 150;
  const listRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(450);
  const lastRun = useRef(-Infinity);
  const rows: RecordItem[] = listRows(state.records, state.query, state.group);
  const counts: [string, number][] = groupCounts(state.records, state.pinned);
  const selectedIndex = rows.findIndex(record => record.id === state.selected);

  // Rubick callbacks can replay synchronously while clearing input; keep the latest state outside React's render cycle.
  function update(next: State) { current.current = next; setState(next); }
  function commit(records: RecordItem[], extra: Partial<State> = {}) {
    const next = prune(records);
    const pinned: string[] = groupCounts(records, extra.pinned ?? current.current.pinned).map(([group]: [string, number]) => group);
    try { save(next, pinned); } catch (error) { void message.error(`保存失败：${(error as Error).message}`); }
    update({ ...current.current, ...extra, records: next, pinned });
  }
  function clearScroll() { if (listRef.current) listRef.current.scrollTop = 0; setScroll(0); }
  function input(text: string) {
    const snapshot = current.current;
    update({ ...snapshot, query: text, selected: listRows(snapshot.records, text, snapshot.group)[0]?.id ?? null });
    clearScroll();
  }
  function launch(raw: string) {
    const command = raw.trim();
    if (!command) { void message.info('先输入路径或命令'); return; }
    const started = now();
    if (started - lastRun.current < 180) return;
    lastRun.current = started;
    try { rubick?.setSubInputValue(''); } catch { /* The command was captured before the callback replay. */ }
    void spawnCommand(command).then(() => {
      const stamp = now();
      const existing = current.current.records.find(record => record.command === command);
      const record = { ...(existing || { id: `run-${stamp}-${Math.random().toString(36).slice(2, 7)}`, groups: [] }), command, time: stamp, kind: guessKind(command), groups: (existing?.groups ?? []).filter(group => group !== ERROR_GROUP) };
      commit([record, ...current.current.records.filter(item => item.id !== record.id)], { selected: null, query: '', pinned: current.current.pinned.filter(group => group !== ERROR_GROUP) });
      log('window-hide', JSON.stringify({ command, stage: 'request', available: !!rubick?.hideMainWindow }));
      rubick?.hideMainWindow?.();
      log('window-hide', JSON.stringify({ command, stage: 'returned' }));
      log('plugin-exit', JSON.stringify({ command, stage: 'request', available: !!rubick?.outPlugin }));
      rubick?.outPlugin?.();
      log('plugin-exit', JSON.stringify({ command, stage: 'returned' }));
    }, error => {
      const existing = current.current.records.find(record => record.command === command);
      if (existing) {
        commit(current.current.records.map(record => record.id === existing.id
          ? { ...record, time: now(), groups: [...new Set([...groupsOf(record), ERROR_GROUP])] } : record));
      }
      log('plugin-stay', JSON.stringify({ command, error: error.message }));
      void message.error(`启动失败：${error.message}`, 0);
    });
  }
  function openEditor(value: Editor) { setName(value.name); setEditor(value); }
  function editGroups(record: RecordItem, group: string, remove = false) {
    const records = current.current.records.map(item => item.id === record.id
      ? { ...item, groups: remove ? groupsOf(item).filter((tag: string) => tag !== group) : [...new Set([...groupsOf(item), group])] } : item);
    commit(records);
  }
  function submitEditor() {
    const value = name.trim();
    if (!value || !editor) { setEditor(null); return; }
    const snapshot = current.current;
    if (editor.mode === 'create') {
      commit(snapshot.records, { pinned: [...new Set([...snapshot.pinned, value])], group: value, selected: null });
      clearScroll();
    } else {
      commit(snapshot.records.map(record => ({ ...record, groups: [...new Set<string>(groupsOf(record).map((tag: string) => tag === editor.name ? value : tag))] })),
        { pinned: [...new Set(snapshot.pinned.map(tag => tag === editor.name ? value : tag))], group: snapshot.group === editor.name ? value : snapshot.group, selected: null });
    }
    setEditor(null);
  }
  function removeTag(group: string) {
    const snapshot = current.current;
    commit(snapshot.records.map(record => ({ ...record, groups: groupsOf(record).filter((tag: string) => tag !== group) })),
      { pinned: snapshot.pinned.filter(tag => tag !== group), group: snapshot.group === group ? '' : snapshot.group, selected: null });
  }
  useEffect(() => {
    const initialize = () => {
      const snapshot = current.current, { records, pinned } = loadStore();
      update({ ...snapshot, records, pinned, selected: listRows(records, snapshot.query, snapshot.group)[0]?.id ?? null });
      clearScroll();
      try { rubick?.setExpendHeight(570); } catch { /* Optional host capability. */ }
    };
    try {
      rubick?.setSubInput(data => input(typeof data === 'object' ? data.text ?? '' : data), '输入路径、程序名或命令，回车运行', true);
      rubick?.onPluginReady(initialize);
    } catch (error) { void message.error(`接管搜索框失败：${(error as Error).message}`); }
    const onKey = (event: KeyboardEvent) => {
      if (keyName(event) === 'escape' && escapeHeld.current) {
        event.preventDefault(); event.stopImmediatePropagation();
        logInputState('input-escape-repeat-blocked', { repeat: event.repeat });
        return;
      }
      if (keyName(event) === 'escape' && (panelOpen.current || editing.current || tagMenuOpen.current)) {
        logInputState('input-escape-plugin-received', { panel: panelOpen.current, editor: !!editing.current, tagMenu: tagMenuOpen.current, target: (event.target as HTMLElement)?.tagName });
        event.preventDefault();
        event.stopImmediatePropagation();
        escapeHeld.current = true;
        setAwaitEscapeRelease(true);
        setPanel(null); setEditor(null); setTagMenu(null);
        return;
      }
      if (panelOpen.current) {
        return;
      }
      if (editing.current || (event.target as HTMLElement)?.closest?.('input,textarea,.ant-dropdown')) return;
      const key = keyName(event), snapshot = current.current;
      const filtered: RecordItem[] = listRows(snapshot.records, snapshot.query, snapshot.group);
      if (key === 'enter') {
        event.preventDefault();
        launch(filtered.find(record => record.id === snapshot.selected)?.command ?? snapshot.query);
      } else if (key === 'down' || key === 'up') {
        event.preventDefault();
        const index = nextSelection(filtered.findIndex(record => record.id === snapshot.selected), key === 'down' ? 1 : -1, filtered.length);
        update({ ...snapshot, selected: filtered[index]?.id ?? null });
      } else if (key === 'escape') { input(''); }
    };
    window.addEventListener('keydown', onKey, true);
    const onKeyUp = (event: KeyboardEvent) => {
      if (keyName(event) !== 'escape' || !escapeHeld.current) return;
      event.preventDefault(); event.stopImmediatePropagation();
      logInputState('input-escape-released');
      window.setTimeout(() => {
        escapeHeld.current = false;
        setAwaitEscapeRelease(false);
      }, 0);
    };
    window.addEventListener('keyup', onKeyUp, true);
    const closeMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.ant-dropdown,.filter-slot') && tagMenuOpen.current) { logInputState('input-menu-close', { menu: 'tag-filter', reason: 'outside-click' }); setTagMenu(null); }
      if (!target.closest('.record-tag-panel,.record-panel-anchor') && panelOpen.current) { logInputState('input-menu-close', { menu: 'record-tags', reason: 'outside-click' }); setPanel(null); }
      if (!editing.current && !target.closest('input,textarea,.ant-input-affix-wrapper,#tagAdd,.ant-dropdown,.record-tag-panel,.record-panel-anchor')) focusHostInput();
    };
    document.addEventListener('click', closeMenu, true);
    const retainFocus = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest('input,textarea,.ant-input-affix-wrapper')) event.preventDefault();
    };
    document.addEventListener('mousedown', retainFocus);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKeyUp, true); document.removeEventListener('click', closeMenu, true); document.removeEventListener('mousedown', retainFocus); };
  }, []);

  useLayoutEffect(() => {
    if (panel || editor || tagMenu !== null || awaitEscapeRelease) {
      logInputState('input-menu-open', { menu: panel ? 'record-tags' : editor ? 'tag-editor' : 'tag-filter', recordId: panel?.id });
      return suspendHostEscape();
    }
    focusHostInput();
  }, [!!panel || !!editor || tagMenu !== null || awaitEscapeRelease]);

  useLayoutEffect(() => {
    const resize = () => setViewport({ width: innerWidth, height: innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useLayoutEffect(() => {
    const element = listRef.current!;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = listRef.current;
    if (!element || selectedIndex < 0) return;
    const top = selectedIndex * ROW_H;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_H > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW_H - element.clientHeight;
    setScroll(element.scrollTop);
  }, [state.selected, selectedIndex]);

  const from = Math.max(0, Math.floor(scroll / ROW_H) - 2);
  const to = Math.min(rows.length, Math.ceil((scroll + height) / ROW_H) + 2);
  const filter = (group: string) => {
    const snapshot = current.current;
    update({ ...snapshot, group, selected: listRows(snapshot.records, snapshot.query, group)[0]?.id ?? null });
    clearScroll();
  };
  const filterTag = (group: string, count: number) => <Tag className={`tag ${state.group === group ? 'on' : ''}`} data-group={group}
    onClick={() => filter(group)} role="button" tabIndex={0} onKeyDown={event => { if (keyName(event) === 'enter') { event.stopPropagation(); filter(group); } }}>
    {group || '全部'}<Badge className="n" count={count} showZero overflowCount={99999} /></Tag>;

  return <div className="app">
    <div className="bar"><div className="tags" id="tags">
      {editor ? <Space.Compact className="tag-editor">
        <Input id="tagInput" autoFocus value={name} onChange={event => setName(event.target.value)} placeholder={editor.mode === 'rename' ? '新名字' : '标签名称'}
          onKeyDown={event => { const key = keyName(event); if (key === 'enter') { event.preventDefault(); submitEditor(); } else if (key === 'escape') setEditor(null); event.stopPropagation(); }} />
        <Tooltip title="确认"><Button id="tagConfirm" aria-label="确认" icon={<CheckOutlined />} onClick={submitEditor} /></Tooltip>
        <Tooltip title="取消"><Button id="tagCancel" aria-label="取消" icon={<CloseOutlined />} onClick={() => setEditor(null)} /></Tooltip>
      </Space.Compact> : <>
        {filterTag('', state.records.length)}
        {counts.map(([group, count]) => <Dropdown key={group} trigger={['contextMenu']} open={tagMenu === group} onOpenChange={open => { if (open) setTagMenu(group); }} menu={{ items: [
          { key: 'rename', icon: <EditOutlined />, label: '重命名标签' }, { key: 'delete', icon: <DeleteOutlined />, danger: true, label: '删除标签' }
        ], onClick: ({ key }) => { setTagMenu(null); if (key === 'rename') openEditor({ mode: 'rename', name: group }); else removeTag(group); } }}><span className="filter-slot" onContextMenu={event => { event.preventDefault(); setTagMenu(group); }}>{filterTag(group, count)}</span></Dropdown>)}
        <Tooltip title="新建标签"><Button id="tagAdd" type="text" aria-label="新建标签" icon={<PlusOutlined />} onClick={() => openEditor({ mode: 'create', name: '' })} /></Tooltip>
      </>}
    </div></div>
    <div className="list" id="list" ref={listRef} onScroll={event => setScroll(event.currentTarget.scrollTop)}>
      {!rows.length ? <Empty className="empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description={state.records.length ? '没有匹配的记录' : '还没有记录'} />
        : <div className="spacer" id="spacer" style={{ height: rows.length * ROW_H }}>
          {rows.slice(from, to).map((record, offset) => {
            const tags: string[] = groupsOf(record);
            const kind = record.kind === 'path' ? 'path' : 'term';
            const Icon = kind === 'path' ? FolderOutlined : CodeOutlined;
            const date = new Date(record.time), today = new Date(now());
            const sameDay = date.toDateString() === today.toDateString();
            const time = sameDay ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            return <div key={record.id} className={`row${record.id === state.selected ? ' sel' : ''}`} data-id={record.id} style={{ top: (from + offset) * ROW_H, height: ROW_H }} onClick={() => launch(record.command)}
                onContextMenu={event => { event.preventDefault(); if (record.id === INPUT_ROW_ID) return; update({ ...current.current, selected: record.id }); setTagMenu(null); setPanel({ id: record.id, x: event.clientX, y: event.clientY, groups: counts.map(([group]) => group) }); }}>
                <span className={`ico ${kind}`}><Icon /></span><span className="cmd" title={record.command}>{record.command}</span>
                <span className="chips" onClick={event => event.stopPropagation()}>
                  {tags.slice(0, 2).map(group => <Tag key={group} className={`chip${group === ERROR_GROUP ? ' error' : ''}`} closable onClose={event => { event.preventDefault(); event.stopPropagation(); editGroups(record, group, true); }}><span className="chip-name" title={group}>{group}</span></Tag>)}
                  {tags.length > 2 && <Tag className="chip more">+{tags.length - 2}</Tag>}
                </span><span className="time">{record.id === INPUT_ROW_ID ? '' : time}</span>
              </div>;
          })}
        </div>}
    </div>
    {panel && panelRecord && <Popover open placement="bottomLeft" arrow={false} trigger={[]} autoAdjustOverflow={false}
      align={{ points: ['tl', 'tl'], offset: [0, 0], overflow: { adjustX: false, adjustY: false } }} overlayClassName="record-panel-popover"
      content={<RecordTagPanel key={panel.id} record={panelRecord} listHeight={panelListHeight} groups={[...new Set([...panel.groups, ...counts.map(([group]) => group)])]}
        onToggle={(group, remove) => editGroups(panelRecord, group, remove)}
        onCopy={() => { void copy(panelRecord.command).then(() => message.success('已复制命令'), () => message.error('复制失败')); }}
        onDelete={() => { commit(current.current.records.filter(record => record.id !== panel.id), { selected: null }); setPanel(null); }}
        onClose={() => setPanel(null)} />}>
      <span className="record-panel-anchor" style={{ left: Math.max(12, Math.min(panel.x, viewport.width - 292)), top: Math.max(12, Math.min(panel.y, viewport.height - panelHeight - 12)) }} />
    </Popover>}
  </div>;
}
