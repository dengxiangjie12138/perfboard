import { Modal } from '../../components/Common';
import type { TrashConfirmation } from './trash';
interface Props { confirmation: TrashConfirmation; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void; onRefresh: () => void }
export function TrashDeleteDialog({ confirmation, busy, error, onCancel, onConfirm, onRefresh }: Props) {
 return <Modal title={confirmation.kind === 'all' ? '清空日志回收站' : '永久删除日志'} onClose={() => { if (!busy) onCancel(); }}>
  <div data-testid="trash-delete-confirmation">
   <p>将永久删除 <strong>{confirmation.projectCount} 个项目、{confirmation.pageCount} 个页面</strong>，以及这些页面的全部版本历史。</p>
   <ul className="log-delete-objects">{confirmation.titles.map((title, index) => <li key={index}>{title}</li>)}</ul>
   <p className="error-text">此操作不可撤销，删除后无法从回收站恢复。活动记录和附件文件会保留。</p>
   {error && <p role="alert" className="error-text">{error}</p>}
   <div className="modal-actions"><button type="button" autoFocus disabled={busy} onClick={onCancel}>取消</button>{error ? <button type="button" disabled={busy} onClick={onRefresh}>刷新并重新确认</button> : <button type="button" className="danger" aria-label="确认永久删除日志" disabled={busy} onClick={onConfirm}>{busy ? '正在删除…' : '确认永久删除'}</button>}</div>
  </div>
 </Modal>;
}
