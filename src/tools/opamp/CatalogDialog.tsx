import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { CATALOG, CATALOG_GROUPS, catalogReference } from './catalog';
import { searchCatalog } from './catalogSearch';
import { CIRCUITS, type CircuitId } from './metadata';
import { ReferenceLink } from './ReferenceLink';
export function CatalogDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (id: CircuitId) => void }) {
  const ref = useRef<HTMLDialogElement>(null), [query, setQuery] = useState(''), [category, setCategory] = useState('all');
  useEffect(() => { ref.current?.showModal(); }, []);
  const matches = searchCatalog(query).filter(entry => category === 'all' || entry[0] === category);
  return <dialog ref={ref} className="opamp-catalog" aria-labelledby="opamp-catalog-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target !== event.currentTarget) return; const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); }}>
    <header><div><h2 id="opamp-catalog-title">运放与比较器电路目录</h2><p>{CATALOG.length} 项 TI 参考电路 · 已开放 {CIRCUITS.length} 个计算器</p></div><button className="icon-button" aria-label="关闭电路目录" onClick={onClose}><X size={18} /></button></header>
    <div className="opamp-catalog-body"><p className="opamp-catalog-intro">常用电路没有统一固定总数。这里按应用整理 TI 资料库中的候选设计；目录内 38 项均已开放，可直接进入计算器；保留各设计的模型说明和 TI 中文来源。</p>
      <div className="opamp-catalog-filters"><input type="search" aria-label="搜索参考电路" placeholder="搜索电路名称或用途…" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="参考电路分类" value={category} onChange={event => setCategory(event.target.value)}><option value="all">全部分类</option>{CATALOG_GROUPS.map(group => <option key={group}>{group}</option>)}</select></div>
      {CATALOG_GROUPS.map(group => { const rows = matches.filter(row => row[0] === group); return rows.length ? <section key={group}><h3>{group} <small>{rows.length}</small></h3><table aria-label={group}><tbody>{rows.map(row => <tr key={row[1]}><td><ReferenceLink href={catalogReference(row)}>{row[1]} ↗</ReferenceLink></td><td>{row[2]}</td><td>{row[4] ? <button className="link small" onClick={() => onOpen(row[4]!)}>打开计算器 →</button> : <span className="opamp-pending">待扩展</span>}</td></tr>)}</tbody></table></section> : null; })}
      {!matches.length && <p className="opamp-empty">没有找到匹配电路。</p>}<p className="opamp-catalog-source">设计参考均来自 <ReferenceLink href="https://www.ti.com.cn/zh-cn/design-development/analog-circuits.html">TI 中文模拟电路资料库 ↗</ReferenceLink>。中文文档或中文设计页面需联网打开。</p>
    </div></dialog>;
}
