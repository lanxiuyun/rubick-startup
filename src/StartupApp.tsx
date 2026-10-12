import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { App, Badge, Button, Dropdown, Empty, Input, Space, Tag, Tooltip, type MenuProps } from 'antd';
import { CheckOutlined, CloseOutlined, CodeOutlined, CopyOutlined, DeleteOutlined, EditOutlined, FileTextOutlined, FolderOutlined, GlobalOutlined, PlusOutlined, TagsOutlined } from '@ant-design/icons';
import { groupCounts, groupsOf, guessKind, keyName, nextSelection, prune, ROW_H, visible } from './model.mjs';
import { copy, load, now, rubick, save, spawnCommand, type RecordItem } from './runtime';

type State = { records: RecordItem[]; query: string; group: string; selected: string | null; pinned: string[] };
type Editor = { mode: 'create' | 'rename' | 'record'; name: string; record?: RecordItem };

function initialState(): State {
  const records = load();
  return { records, query: '', group: '', selected: visible(records)[0]?.id ?? null, pinned: [] };
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
  const listRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(450);
  const lastRun = useRef(-Infinity);
  const rows: RecordItem[] = visible(state.records, state.query, state.group);
  const counts: [string, number][] = groupCounts(state.records, state.pinned);
  const selectedIndex = rows.findIndex(record => record.id === state.selected);

  // Rubick callbacks can replay synchronously while clearing input; keep the latest state outside React's render cycle.
  function update(next: State) { current.current = next; setState(next); }
  function commit(records: RecordItem[], extra: Partial<State> = {}) {
    const next = prune(records);
    try { save(next); } catch (error) { void message.error(`保存失败：${(error as Error).message}`); }
    update({ ...current.current, ...extra, records: next });
  }
  function clearScroll() { if (listRef.current) listRef.current.scrollTop = 0; setScroll(0); }
  function input(text: string) { update({ ...current.current, query: text, selected: null }); clearScroll(); }
  function launch(raw: string) {
    const command = raw.trim();
    if (!command) { void message.info('先输入路径或命令'); return; }
    const stamp = now();
    if (stamp - lastRun.current < 180) return;
    lastRun.current = stamp;
    const existing = current.current.records.find(record => record.command === command);
    const record = { ...(existing || { id: `run-${stamp}-${Math.random().toString(36).slice(2, 7)}`, groups: [] }), command, time: stamp, kind: guessKind(command) };
    commit([record, ...current.current.records.filter(item => item.id !== record.id)], { selected: null, query: '' });
    try { rubick?.setSubInputValue(''); } catch { /* The command was captured before the callback replay. */ }
    void spawnCommand(command).then(() => message.success('已提交给 Windows'), error => message.error(`启动失败：${error.message}`));
  }
  function openEditor(value: Editor) { setName(value.name); setEditor(value); }
  function editGroups(record: RecordItem, group: string, remove = false) {
    const records = current.current.records.map(item => item.id === record.id
      ? { ...item, groups: remove ? groupsOf(item).filter((tag: string) => tag !== group) : [...new Set([...groupsOf(item), group])] } : item);
    commit(records, { selected: null });
  }
  function submitEditor() {
    const value = name.trim();
    if (!value || !editor) { setEditor(null); return; }
    const snapshot = current.current;
    if (editor.mode === 'record') editGroups(editor.record!, value);
    else if (editor.mode === 'create') {
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
  function recordMenu(record: RecordItem): MenuProps {
    const tags: string[] = groupsOf(record);
    const available = counts.filter(([tag]) => !tags.includes(tag));
    return {
      items: [
        { key: 'copy', icon: <CopyOutlined />, label: '复制命令' },
        { key: 'newgroup', icon: <PlusOutlined />, label: '新建标签并加入…' },
        ...(available.length ? [{ key: 'add', icon: <TagsOutlined />, label: '加入已有标签', children: available.map(([tag]) => ({ key: `add:${tag}`, label: tag })) }] : []),
        ...(tags.length ? [{ key: 'remove', label: '移出标签', children: tags.map(tag => ({ key: `remove:${tag}`, label: tag })) }] : []),
        { type: 'divider' as const }, { key: 'delete', icon: <DeleteOutlined />, danger: true, label: '删除这条记录' }
      ],
      onClick: ({ key, domEvent }) => {
        domEvent.stopPropagation();
        if (key === 'copy') void copy(record.command).then(() => message.success('已复制命令'), () => message.error('复制失败'));
        else if (key === 'newgroup') openEditor({ mode: 'record', name: '', record });
        else if (key === 'delete') commit(current.current.records.filter(item => item.id !== record.id), { selected: null });
        else if (key.startsWith('add:')) editGroups(record, key.slice(4));
        else if (key.startsWith('remove:')) editGroups(record, key.slice(7), true);
      }
    };
  }

  useEffect(() => {
    const initialize = () => {
      const snapshot = current.current, records = load();
      update({ ...snapshot, records, selected: snapshot.query.trim() ? null : visible(records, '', snapshot.group)[0]?.id ?? null });
      clearScroll();
      try { rubick?.setExpendHeight(570); } catch { /* Optional host capability. */ }
    };
    try {
      rubick?.setSubInput(data => input(typeof data === 'object' ? data.text ?? '' : data), '输入路径、程序名或命令，回车运行', true);
      rubick?.onPluginReady(initialize);
    } catch (error) { void message.error(`接管搜索框失败：${(error as Error).message}`); }
    const onKey = (event: KeyboardEvent) => {
      if (editing.current || (event.target as HTMLElement)?.closest?.('input,textarea,.ant-dropdown')) return;
      const key = keyName(event), snapshot = current.current;
      const filtered: RecordItem[] = visible(snapshot.records, snapshot.query, snapshot.group);
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
    const closeMenu = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest('.ant-dropdown,.filter-slot')) setTagMenu(null); };
    document.addEventListener('click', closeMenu);
    return () => { window.removeEventListener('keydown', onKey, true); document.removeEventListener('click', closeMenu); };
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
  const filter = (group: string) => { update({ ...current.current, group, selected: null }); clearScroll(); };
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
            const kind = record.kind === 'path' ? 'path' : record.kind === 'url' ? 'url' : /^(notepad|calc)(\.exe)?$/i.test(record.command.trim()) ? 'pad' : 'term';
            const Icon = kind === 'path' ? FolderOutlined : kind === 'url' ? GlobalOutlined : kind === 'pad' ? FileTextOutlined : CodeOutlined;
            const date = new Date(record.time), today = new Date(now());
            const sameDay = date.toDateString() === today.toDateString();
            const time = sameDay ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            return <Dropdown key={record.id} trigger={['contextMenu']} menu={recordMenu(record)}>
              <div className={`row${record.id === state.selected ? ' sel' : ''}`} data-id={record.id} style={{ top: (from + offset) * ROW_H, height: ROW_H }} onClick={() => launch(record.command)}>
                <span className={`ico ${kind}`}><Icon /></span><span className="cmd" title={record.command}>{record.command}</span>
                <span className="chips" onClick={event => event.stopPropagation()}>
                  {tags.slice(0, 2).map(group => <Tag key={group} className="chip" closable onClose={event => { event.preventDefault(); event.stopPropagation(); editGroups(record, group, true); }}><span className="chip-name" title={group}>{group}</span></Tag>)}
                  {tags.length > 2 && <Tag className="chip more">+{tags.length - 2}</Tag>}
                </span><span className="time">{time}</span>
              </div>
            </Dropdown>;
          })}
        </div>}
    </div>
  </div>;
}
