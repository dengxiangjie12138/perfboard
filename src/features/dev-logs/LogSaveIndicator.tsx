import type { LogSaveEvent } from './autosave';
const LABELS = { idle: '已载入', pending: '等待保存…', saving: '正在保存…', saved: '已保存', error: '保存失败，草稿保留在当前页', readonly: '只读' };

export function LogSaveIndicator({ event, pageId, dirty, automatic }: { event: LogSaveEvent; pageId: string; dirty: boolean; automatic: boolean }) {
 let status = event.id === pageId ? event.status : dirty ? 'pending' : 'idle';
 // A status from an older save must not claim the current draft has been stored.
 if (dirty && (status === 'saved' || status === 'idle')) status = 'pending';
 return <span role="status" className={status === 'error' ? 'log-save-error' : ''}>{status === 'pending' && !automatic ? '未保存' : LABELS[status]}</span>;
}
