import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useCurrentEditor, type Editor } from '@tiptap/react';
import { Search, ChevronDown, ChevronUp, X, Palette } from 'lucide-react';
import { collectLogicalLines } from './document';
export const SearchContext = createContext({ open: false, setOpen: (_value: boolean) => {} });
const FOREGROUND_COLORS = [ ['默认', ''], ['红色', '#c43b3b'], ['橙色', '#b86d15'], ['绿色', '#218453'], ['蓝色', '#286cbb'], ['紫色', '#8451b7'] ];
export function ForegroundPalette() {
 const { editor } = useCurrentEditor();
 const menu = useRef<HTMLDetailsElement>(null);
 useEffect(() => {
  const element = menu.current;
  if (!element) return;
  const ownerDocument = element.ownerDocument;
  const close = (returnFocus: boolean) => {
   const restoreTriggerFocus = returnFocus && ownerDocument.activeElement && element.contains(ownerDocument.activeElement);
   element.open = false;
   // Escape from a palette control keeps keyboard focus on the visible trigger.
   // Outside clicks retain their destination and do not refocus the editor.
   if (restoreTriggerFocus) {
    element.querySelector('summary')?.focus({ preventScroll: true });
   }
  };
  const onOutsidePointerDown = (event: PointerEvent) => {
   if (element.open && !event.composedPath().includes(element)) close(false);
  };
  const onEscape = (event: KeyboardEvent) => {
   if (event.key !== 'Escape' || !element.open) return;
   event.preventDefault();
   event.stopPropagation();
   close(true);
  };
  ownerDocument.addEventListener('pointerdown', onOutsidePointerDown, true);
  ownerDocument.addEventListener('keydown', onEscape, true);
  return () => {
   ownerDocument.removeEventListener('pointerdown', onOutsidePointerDown, true);
   ownerDocument.removeEventListener('keydown', onEscape, true);
  };
 }, []);
 return <details ref={menu} className="log-color-menu"><summary title="文字颜色" aria-label="文字颜色" onMouseDown={event => { if (event.button === 0) event.preventDefault(); }}><Palette size={17}/></summary><div role="group" aria-label="文字颜色选择">{FOREGROUND_COLORS.map(([label, color]) => <button type="button" key={label} disabled={!editor?.isEditable} title={label} aria-label={`文字${label}`} style={{ color: color || 'var(--text)' }} onMouseDown={event => { if (event.button === 0) event.preventDefault(); }} onClick={() => { if (color) editor?.chain().focus().setColor(color).run(); else editor?.chain().focus().unsetColor().run(); }}><span style={{ background: color || 'var(--text)' }}/>{label}</button>)}</div></details>;
}
export function FindButton() { const { setOpen } = useContext(SearchContext); return <button type="button" className="log-find-button" title="当前页面查找 (Ctrl+F)" aria-label="当前页面查找" onClick={() => setOpen(true)}><Search size={17}/></button>; }
export function FindPanel({ editor, readOnly }: { editor: Editor | null; readOnly: boolean }) {
 const { open, setOpen } = useContext(SearchContext); const [query, setQuery] = useState(''); const [replacement, setReplacement] = useState(''); const [sensitive, setSensitive] = useState(false); const [matches, setMatches] = useState({ total: 0, index: 0 }); const input = useRef<HTMLInputElement>(null);
 useEffect(() => { if (open) input.current?.focus(); else editor?.commands.clearSearch(); }, [open, editor]);
 useEffect(() => {
  if (!editor) return;
  const update = () => { const search = editor.storage.findAndReplace; setMatches({ total: search.results.length, index: search.currentIndex === null ? 0 : search.currentIndex + 1 }); };
  editor.on('transaction', update); return () => { editor.off('transaction', update); };
 }, [editor]);
 useEffect(() => { if (open) { editor?.commands.setSearchTerm(query); editor?.commands.setReplaceTerm(replacement); editor?.commands.setCaseSensitive(sensitive); } }, [editor, open, query, replacement, sensitive]);
 if (!open) return null;
 return <div className="log-find-panel" role="search" aria-label="当前页面查找替换" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); editor?.commands.focus(); } }}><div><Search size={15}/><input ref={input} value={query} onChange={event => setQuery(event.target.value)} placeholder="查找当前页面" aria-label="查找内容" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (event.shiftKey) editor?.commands.goToPreviousResult(); else editor?.commands.goToNextResult(); } }}/><span aria-live="polite">{matches.index}/{matches.total}</span><button type="button" title="上一个" aria-label="上一个匹配" disabled={!matches.total} onClick={() => editor?.commands.goToPreviousResult()}><ChevronUp size={15}/></button><button type="button" title="下一个" aria-label="下一个匹配" disabled={!matches.total} onClick={() => editor?.commands.goToNextResult()}><ChevronDown size={15}/></button><label><input type="checkbox" checked={sensitive} onChange={event => setSensitive(event.target.checked)}/>区分大小写</label><button type="button" title="关闭查找" aria-label="关闭查找" onClick={() => setOpen(false)}><X size={15}/></button></div><div><input value={replacement} onChange={event => setReplacement(event.target.value)} placeholder="替换为" aria-label="替换内容"/><button type="button" disabled={readOnly || !matches.total} onClick={() => editor?.commands.replace()}>替换</button><button type="button" disabled={readOnly || !matches.total} onClick={() => editor?.commands.replaceAll()}>全部替换</button></div></div>;
}
export function LogicalGutter({ editor, sheetRef }: { editor: Editor | null; sheetRef: RefObject<HTMLDivElement | null> }) {
 const [lines, setLines] = useState<{ number: number; top: number }[]>([]);
 useLayoutEffect(() => {
  if (!editor || !sheetRef.current) return;
  let frame = 0;
  const measure = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
   if (editor.isDestroyed || !sheetRef.current) return;
   const origin = sheetRef.current.getBoundingClientRect().top;
   setLines(collectLogicalLines(editor.state.doc).flatMap(line => { const node = editor.view.nodeDOM(line.position); const element = node instanceof HTMLElement ? node : node?.parentElement; return element ? [{ number: line.number, top: element.getBoundingClientRect().top - origin }] : []; }));
  }); };
  const resize = new ResizeObserver(measure); resize.observe(editor.view.dom); editor.on('transaction', measure); window.addEventListener('resize', measure); measure();
  return () => { cancelAnimationFrame(frame); resize.disconnect(); editor.off('transaction', measure); window.removeEventListener('resize', measure); };
 }, [editor, sheetRef]);
 return <div className="log-line-gutter" aria-hidden="true" contentEditable={false} data-testid="log-line-gutter">{lines.map(line => <span key={line.number} style={{ top: line.top }}>{line.number}</span>)}</div>;
}
