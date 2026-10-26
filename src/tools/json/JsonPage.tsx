import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Heading } from '../../components/Common';
import { copyJson, searchJson, transformJson, validateJson, type JsonOperation } from './algorithm';
import type { JsonTreeApi } from './JsonTree';
import './json.css';
import { useViewMemory } from '../../services/useViewMemory';
import { useTextDraft } from '../../windows/useTextDraft';

const JsonTree = lazy(() => import('./JsonTree').then(module => ({ default: module.JsonTree })));
const EXAMPLE = '{\n  "名称": "Perfboard",\n  "整数": 18446744073709551615,\n  "启用": true,\n  "项目": [1, 2, 3]\n}';
const OPERATIONS: { operation: JsonOperation; label: string }[] = [
  { operation: 'format', label: '格式化' }, { operation: 'compact', label: '压缩' },
  { operation: 'escape', label: '转义' }, { operation: 'unescape', label: '反转义' },
  { operation: 'compact-escape', label: '压缩并转义' },
];
export function JsonPage() {
  const [raw, setRaw, draftNotice] = useTextDraft('json');
  const [checkedRaw, setCheckedRaw] = useState(raw);
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useViewMemory('json-query', '');
  const [matchIndex, setMatchIndex] = useState(0);
  const treeApi = useRef<JsonTreeApi | null>(null);
  useEffect(() => { const timer = setTimeout(() => setCheckedRaw(raw), 250); return () => clearTimeout(timer); }, [raw]);
  const validation = useMemo(() => validateJson(checkedRaw), [checkedRaw]);
  const pending = checkedRaw !== raw;
  const usable = !pending && validation.status === 'valid';
  const matches = useMemo(() => validation.status === 'valid' && !pending ? searchJson(validation.value, query) : [], [validation, query, pending]);
  function edit(next: string) { setRaw(next); setNotice(''); setMatchIndex(0); }
  function operate(operation: JsonOperation) {
    try { const next = transformJson(raw, operation); edit(next); setCheckedRaw(next); setNotice('操作已完成。'); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }
  function locate(index: number) {
    if (!matches.length) return;
    const next = (index + matches.length) % matches.length;
    setMatchIndex(next); treeApi.current?.select(matches[next].path);
  }
  return <section className="json-page">
    <Heading eyebrow="LOCAL UTILITIES" title="JSON解析" description="原文与树形双向编辑，完整保留大整数精度。所有处理均在本地进行。" />
    {draftNotice && <p className="help" role="status">{draftNotice}</p>}
    <div className="json-toolbar">
      {OPERATIONS.map(({ operation, label }) => <button id={`json-${operation}`} key={operation} className="small" onClick={() => operate(operation)}>{label}</button>)}
      <button id="json-copy" className="small" onClick={() => { void copyJson(raw, navigator.clipboard).then(setNotice); }}>复制原文</button>
      <button className="small" onClick={() => { edit(EXAMPLE); setCheckedRaw(EXAMPLE); }}>载入示例</button>
      <button className="small" onClick={() => { edit(''); setCheckedRaw(''); }}>清空</button>
    </div>
    <div id="json-status" className={`json-status ${validation.status === 'invalid' ? 'json-error' : ''}`} role="status" aria-live="polite">{pending ? '原文已变更，正在校验；旧树暂不可操作。' : validation.message}{notice && <span> · {notice}</span>}</div>
    <div className="json-columns">
      <div className="json-pane"><div className="json-pane-heading"><label htmlFor="json-input">JSON 原文</label><span>{raw.length.toLocaleString()} 字符</span></div>
        <textarea id="json-input" spellCheck={false} value={raw} onChange={event => edit(event.target.value)} placeholder="在此粘贴或输入 JSON…" aria-describedby="json-status" />
      </div>
      <div className="json-pane"><div className="json-pane-heading"><span>树形编辑</span><div className="json-tree-actions"><button id="json-expand" className="small" disabled={!usable} onClick={() => treeApi.current?.expand()}>展开 3 层</button><button id="json-collapse" className="small" disabled={!usable} onClick={() => treeApi.current?.collapse()}>折叠</button></div></div>
        <div className="json-search-row"><input id="json-search" aria-label="搜索 JSON 键或值" placeholder="搜索键或值" value={query} disabled={!usable} onChange={event => { setQuery(event.target.value); setMatchIndex(0); }} onKeyDown={event => { if (event.key === 'Enter') locate(matchIndex); }} />
          <button className="small" disabled={!matches.length} onClick={() => locate(matchIndex - 1)} aria-label="上一个匹配">上一项</button><button className="small" disabled={!matches.length} onClick={() => locate(matchIndex + 1)} aria-label="下一个匹配">下一项</button>
        </div>
        {query && <div className="json-search-status">{matches.length ? `${matchIndex + 1}/${matches.length}${matches.length === 200 ? '（最多显示 200 项）' : ''} · ${matches[matchIndex]?.label ?? ''}` : '没有匹配项'}{matches.length > 0 && <button className="link small" onClick={() => locate(matchIndex)}>定位</button>}</div>}
        {validation.status === 'valid' ? <div className={`json-tree-container ${pending ? 'json-tree-stale' : ''}`} inert={pending} aria-hidden={pending}><Suspense fallback={<div className="json-tree-empty">正在加载本地树形编辑器…</div>}><JsonTree raw={checkedRaw} apiRef={treeApi} onChange={next => { edit(next); setCheckedRaw(next); }} onError={setNotice} /></Suspense></div> : <div id="json-tree" className="json-tree-empty">{validation.status === 'empty' ? '等待 JSON 输入' : '原文无效或超过大小限制，树形编辑已暂停。'}</div>}
      </div>
    </div>
    <p className="help">格式化与压缩需有效 JSON；转义把整段原文编码为 JSON 字符串，反转义只接受完整 JSON 字符串。双击树中值可编辑，树形修改会回写原文。树形解析上限为 256 Ki 个字符；较深结构请逐层展开。</p>
  </section>;
}

