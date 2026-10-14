import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Empty, Input, Tooltip } from 'antd';
import { CloseOutlined, CopyOutlined, DeleteOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { groupsOf, keyName } from './model.mjs';
import type { RecordItem } from './runtime';
import VirtualList from 'rc-virtual-list';

type Props = {
  record: RecordItem;
  groups: string[];
  listHeight: number;
  onToggle: (group: string, remove: boolean) => void;
  onCopy: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export function RecordTagPanel({ record, groups, listHeight, onToggle, onCopy, onDelete, onClose }: Props) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<any>(null);
  const checked: string[] = groupsOf(record);
  const name = query.trim();
  const canCreate = !!name && !groups.includes(name);
  const filtered = groups.filter(group => group.toLocaleLowerCase().includes(name.toLocaleLowerCase()))
    .sort((a, b) => Number(checked.includes(b)) - Number(checked.includes(a)));
  const create = () => { if (canCreate) { onToggle(name, false); setQuery(''); } };
  useEffect(() => { searchRef.current?.focus(); }, []);
  return <div className="record-tag-panel" onClick={event => event.stopPropagation()}
    onKeyDown={event => {
      const key = keyName(event);
      if (key === 'escape') { event.preventDefault(); onClose(); }
      else if (key === 'enter' && event.target instanceof HTMLInputElement && event.target.type !== 'checkbox') { event.preventDefault(); create(); }
      event.stopPropagation();
    }}>
    <div className="panel-action"><Button type="text" block aria-label="复制命令" icon={<CopyOutlined />} onClick={onCopy}>复制命令</Button></div>
    <div className="panel-search">
      <Input ref={searchRef} aria-label="搜索标签" placeholder="搜索标签" prefix={<SearchOutlined />} allowClear value={query} onChange={event => setQuery(event.target.value)} />
      <Tooltip title="新建标签并加入"><Button aria-label="新建标签并加入" icon={<PlusOutlined />} disabled={!canCreate} onClick={create} /></Tooltip>
      <Tooltip title="关闭菜单"><Button aria-label="关闭菜单" icon={<CloseOutlined />} onClick={onClose} /></Tooltip>
    </div>
    <div className="panel-tags">
      <VirtualList data={filtered} height={listHeight} itemHeight={36} itemKey={group => group} showScrollBar
        styles={{ verticalScrollBar: { width: 6 }, verticalScrollBarThumb: { background: '#adc9ef', borderRadius: 3 } }}>
        {group => <Checkbox style={{ height: 36 }} checked={checked.includes(group)} onChange={event => onToggle(group, !event.target.checked)}><span title={group}>{group}</span></Checkbox>}
      </VirtualList>
      {canCreate && <Button className="panel-create" type="text" icon={<PlusOutlined />} onClick={create} title={`创建「${name}」并加入`}>创建「{name}」并加入</Button>}
      {!filtered.length && !canCreate && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无标签" />}
    </div>
    <div className="panel-action panel-footer"><Button type="text" danger block aria-label="删除这条记录" icon={<DeleteOutlined />} onClick={onDelete}>删除这条记录</Button></div>
  </div>;
}
