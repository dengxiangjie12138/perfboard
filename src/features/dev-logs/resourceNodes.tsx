import { createContext, useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { save } from '@tauri-apps/plugin-dialog';
import { Download, ExternalLink, File, Image as ImageIcon, LoaderCircle, RotateCcw } from 'lucide-react';
import { LogFileAttachment, LogImage } from './resourceSchema';
import { logResourceApi, type LogResourceController, type LogResourceMetadata } from './resourceApi';
import { formatResourceSize } from './resourceTransfer';
import { boundedImageDisplayWidth, cornerResizeDelta, resizeDragAxis, resizedImageDisplayWidth, validImageDisplayWidth, type ImageResizeCorner, type ResizeDragAxis } from './imageSizing';

export const LogResourceContext = createContext<LogResourceController | null>(null);

const IMAGE_CORNERS: { corner: ImageResizeCorner; label: string }[] = [
 { corner: 'nw', label: '左上角' }, { corner: 'ne', label: '右上角' },
 { corner: 'sw', label: '左下角' }, { corner: 'se', label: '右下角' },
];
interface ResizeGesture { pointerId: number; x: number; y: number; width: number; ratio: number; maximum: number; target: HTMLButtonElement; nextWidth: number; corner: ImageResizeCorner; axis: ResizeDragAxis | null }
function ResourceView({ node, selected, editor, getPos, updateAttributes }: NodeViewProps) {
 const controller = useContext(LogResourceContext);
 const id = node.attrs.resourceId as string;
 const isImage = node.type.name === 'image';
 const [metadata, setMetadata] = useState<LogResourceMetadata | null>(null);
 const [imageUrl, setImageUrl] = useState('');
 const [error, setError] = useState('');
 const [busy, setBusy] = useState(false);
 const frameRef = useRef<HTMLDivElement>(null);
 const imageRef = useRef<HTMLImageElement>(null);
 const resize = useRef<ResizeGesture | null>(null);
 const suppressOpenUntil = useRef(0);
 const [draftWidth, setDraftWidth] = useState<number | null>(null);
 const [visible, setVisible] = useState(false);
 const storedWidth = typeof node.attrs.displayWidth === 'number' && validImageDisplayWidth(node.attrs.displayWidth) ? node.attrs.displayWidth : null;
 const displayWidth = draftWidth ?? storedWidth;
 const editable = editor.isEditable;
 const repositoryKey = controller?.context.repositoryKey;
 const pageId = controller?.context.pageId;
 useEffect(() => {
  const cancel = () => {
   const gesture = resize.current;
   resize.current = null;
   setDraftWidth(null);
   if (gesture) suppressOpenUntil.current = Date.now() + 700;
   if (gesture?.target.hasPointerCapture(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId);
  };
  const onKey = (event: KeyboardEvent) => {
   if (event.key === 'Escape' && resize.current) { event.preventDefault(); event.stopPropagation(); cancel(); }
  };
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', cancel);
  return () => {
   document.removeEventListener('keydown', onKey, true);
   window.removeEventListener('blur', cancel);
   const gesture = resize.current;
   resize.current = null;
   if (gesture?.target.hasPointerCapture(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId);
  };
 }, [id]);
 useEffect(() => {
  if (selected && editable) return;
  const gesture = resize.current;
  resize.current = null;
  setDraftWidth(null);
  if (gesture) {
   suppressOpenUntil.current = Date.now() + 700;
   if (gesture.target.hasPointerCapture(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId);
  }
 }, [selected, editable]);
 useEffect(() => {
  let disposed = false;
  setMetadata(null); setImageUrl(''); setError('');
  if (!controller || !id) { setError('附件引用不可用'); return; }
  const context = controller.context;
  void (async () => {
   const values = await logResourceApi.metadata(context, [id]);
   const value = values[0];
   if (!value) throw new Error('附件不存在，可能已删除或当前数据库不匹配');
   if (disposed) return;
   setMetadata(value);
   if (isImage && !value.isImage) throw new Error('此附件不是可显示的图片');
  })().catch(failure => { if (!disposed) setError(String(failure instanceof Error ? failure.message : failure)); });
  return () => { disposed = true; };
  // Loading is scoped to repository/page/id. Document saves must not reload binary data.
 }, [repositoryKey, pageId, id, isImage]);
 useEffect(() => {
  if (!isImage) return;
  if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
  const observer = new IntersectionObserver(entries => {
   if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
  }, { rootMargin: '600px' });
  if (frameRef.current) observer.observe(frameRef.current);
  return () => observer.disconnect();
 }, [isImage, id]);
 useEffect(() => {
  if (!controller || !isImage || !metadata?.isImage || metadata.id !== id || !visible) return;
  let disposed = false; let url = '';
  void logResourceApi.read(controller.context, id).then(bytes => {
   if (disposed) return;
   url = URL.createObjectURL(new Blob([bytes], { type: metadata.mime }));
   setImageUrl(url);
  }).catch(failure => { if (!disposed) setError(String(failure instanceof Error ? failure.message : failure)); });
  return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  // The stored bytes are immutable; revisions and incidental UI renders do not reload them.
 }, [repositoryKey, pageId, id, isImage, metadata?.id, metadata?.mime, metadata?.isImage, visible]);
 const act = async (action: 'open' | 'save') => {
  if (!controller || !metadata || busy) return;
  setBusy(true);
  try {
   if (action === 'open') await logResourceApi.open(controller.context, id);
   else {
    const destination = await save({ title: '附件另存为', defaultPath: metadata.name });
    if (destination) await logResourceApi.export(controller.context, id, destination);
   }
  } catch (failure) { controller.onError(failure); }
  finally { setBusy(false); }
 };
 const selectImage = () => {
  const position = getPos();
  if (editor.isEditable && typeof position === 'number') editor.chain().focus().setNodeSelection(position).run();
 };
 const startResize = (event: ReactPointerEvent<HTMLButtonElement>, corner: ImageResizeCorner) => {
  if (!editor.isEditable || event.button !== 0 || !imageRef.current || !frameRef.current) return;
  event.preventDefault(); event.stopPropagation();
  const bounds = imageRef.current.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return;
  selectImage();
  event.currentTarget.setPointerCapture(event.pointerId);
  suppressOpenUntil.current = Infinity;
  resize.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: bounds.width, ratio: bounds.width / bounds.height, maximum: frameRef.current.clientWidth, target: event.currentTarget, nextWidth: bounds.width, corner, axis: null };
 };
 const moveResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
  const gesture = resize.current;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  event.preventDefault();
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  if (!gesture.axis) {
   if (Math.hypot(dx, dy) < 3) return;
   gesture.axis = resizeDragAxis(dx, dy, gesture.ratio);
  }
  gesture.nextWidth = resizedImageDisplayWidth(gesture.width, gesture.ratio, dx, dy, gesture.maximum, gesture.corner, gesture.axis);
  setDraftWidth(gesture.nextWidth);
 };
 const finishResize = (event: ReactPointerEvent<HTMLButtonElement>, commit: boolean) => {
  const gesture = resize.current;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  resize.current = null;
  suppressOpenUntil.current = Date.now() + 700;
  if (commit && editor.isEditable && gesture.axis && Math.abs(gesture.nextWidth - gesture.width) >= 1) updateAttributes({ displayWidth: gesture.nextWidth });
  setDraftWidth(null);
  if (gesture.target.hasPointerCapture(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId);
 };
 return <NodeViewWrapper className={`log-resource ${isImage ? 'log-resource-image' : 'log-resource-file'}${selected ? ' is-selected' : ''}`} data-log-resource-id={id}>
  <div ref={frameRef} contentEditable={false}>
   {isImage && imageUrl && <div className={`log-resource-image-stage${displayWidth !== null ? ' has-display-width' : ''}${draftWidth !== null ? ' is-resizing' : ''}${selected && editable ? ' is-resize-selected' : ''}`} style={displayWidth === null ? undefined : { width: `${displayWidth}px` }} data-display-width={storedWidth ?? 'auto'} data-resize-corner={resize.current?.corner}>
    <button type="button" className="log-resource-image-button" onClick={selectImage} onDoubleClick={() => { if (!resize.current && Date.now() >= suppressOpenUntil.current) void act('open'); }} title={editable ? '单击选中后拖动四角等比例调整大小；双击查看原图' : '双击查看原图'}>
     <img ref={imageRef} src={imageUrl} alt={metadata?.name ?? '日志图片'} draggable={false} onError={() => { URL.revokeObjectURL(imageUrl); setImageUrl(''); setError('图片无法显示，原始文件仍保存在数据库中，可另存为检查'); }}/>
    </button>
    {selected && editable && IMAGE_CORNERS.map(({ corner, label }) => <button key={corner} type="button" className="log-resource-resize-handle" data-corner={corner} aria-label={`${label}等比例调整图片大小`} title={`${label}：拖动等比例缩放；方向键微调，Esc 取消拖动`} onPointerDown={event => startResize(event, corner)} onPointerMove={moveResize} onPointerUp={event => finishResize(event, true)} onPointerCancel={event => finishResize(event, false)} onLostPointerCapture={event => finishResize(event, false)} onClick={event => { event.preventDefault(); event.stopPropagation(); }} onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={event => {
     if (!editor.isEditable || !imageRef.current || !frameRef.current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
     event.preventDefault(); event.stopPropagation();
     const step = cornerResizeDelta(corner, event.key, event.shiftKey ? 32 : 8);
     updateAttributes({ displayWidth: boundedImageDisplayWidth(imageRef.current.getBoundingClientRect().width + step, frameRef.current.clientWidth) });
    }}/>)}
   </div>}
   {isImage && selected && editable && <div className="log-resource-size-tools">
    <small>{displayWidth === null ? '原始大小' : `宽 ${Math.round(displayWidth)} px`}<span className="log-resource-size-note"> · 等比例显示</span></small>
    <button type="button" disabled={storedWidth === null || draftWidth !== null} onClick={() => { if (editor.isEditable) updateAttributes({ displayWidth: null }); }} title="恢复原始大小，超出编辑区时自动适应"><RotateCcw size={13}/>重置大小</button>
   </div>}
   <div className="log-resource-details" data-drag-handle>
    {isImage ? <ImageIcon size={18}/> : <File size={18}/>}
    <span className="log-resource-name">{metadata?.name ?? (error ? '附件无法载入' : '正在载入附件…')}</span>
    {metadata && <small>{formatResourceSize(metadata.size)}</small>}
    {busy && <LoaderCircle size={15} className="spin"/>}
    <button type="button" disabled={!metadata || busy} onClick={() => void act('open')} title="用系统默认程序打开临时副本；外部修改不会自动回写日志"><ExternalLink size={15}/><span>打开</span></button>
    <button type="button" disabled={!metadata || busy} onClick={() => void act('save')} title="另存为"><Download size={15}/><span>另存为</span></button>
   </div>
   {error && <div className="log-resource-error" role="status">{error}</div>}
  </div>
 </NodeViewWrapper>;
}
export const LogImageView = LogImage.extend({ addNodeView() { return ReactNodeViewRenderer(ResourceView); } });
export const LogFileAttachmentView = LogFileAttachment.extend({ addNodeView() { return ReactNodeViewRenderer(ResourceView); } });
