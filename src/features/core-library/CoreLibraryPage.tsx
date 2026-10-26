import { useMemo } from 'react';
import { useViewMemory } from '../../services/useViewMemory';
import { Search } from 'lucide-react';
import { coreLibraryAudit, coreOptions, coreShapes, coreShapeLabel, displayCoreValue, getCoreOption, getCoreOptions } from './library';
import type { CoreOption, CoreShape, CoreVariant } from './library';
import './core-library.css';

export interface CoreLibraryPageProps { initialQuery?: string; initialCoreId?: string }
function summaryValue(option: CoreOption, key: 'aeMm2' | 'awMm2' | 'alNhPerTurn2'): string {
  if (option.conflicts.some(conflict => conflict.key === key)) return '来源冲突';
  if (key === 'alNhPerTurn2' && option.materials.length > 1) return '按材质选来源';
  return displayCoreValue(option.parameters[key]);
}
function sourceLabel(variant: CoreVariant): string {
  return variant.source.filename + ' · ' + variant.source.sheet + ' · 第 ' + variant.source.row + ' 行';
}
export function CoreLibraryPage({ initialQuery = '', initialCoreId }: CoreLibraryPageProps) {
  const [query, setQuery] = useViewMemory('cores-query', initialQuery);
  const [material, setMaterial] = useViewMemory('cores-material', '');
  const [shape, setShape] = useViewMemory<CoreShape | ''>('cores-shape', '');
  const [selectedId, setSelectedId] = useViewMemory('cores-selected', initialCoreId ? getCoreOption(initialCoreId)?.id ?? '' : '');
  const [variantId, setVariantId] = useViewMemory('cores-variant', '');
  const results = useMemo(() => getCoreOptions({ query, material, shape }), [query, material, shape]);
  const selected = results.find(option => option.id === selectedId);
  const selectedVariant = selected?.variants.find(variant => variant.id === variantId);
  const visibleVariants = selectedVariant ? [selectedVariant] : selected?.variants ?? [];
  const materials = [...new Set(coreOptions.flatMap(option => option.materials))].sort();
  function selectCore(id: string) { setSelectedId(id); setVariantId(''); }
  return <section className="core-library">
    <div className="core-filters">
      <label className="core-search"><Search size={16}/><input aria-label="搜索磁芯参数" placeholder="搜索具体型号、材质或原表参数" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <select aria-label="筛选形状" value={shape} onChange={event => setShape(event.target.value as CoreShape | '')}><option value="">全部形状</option>{coreShapes.map(value => <option key={value} value={value}>{coreShapeLabel(value)}</option>)}</select>
      <select aria-label="筛选材质" value={material} onChange={event => setMaterial(event.target.value)}><option value="">全部材质</option>{materials.map(value => <option key={value} value={value}>{value}</option>)}</select>
      <span className="muted">{results.length} 个结果</span>
    </div>
    <div className="core-selection"><label htmlFor="core-model-choice">具体型号</label><select id="core-model-choice" aria-label="选择具体磁芯型号" value={results.some(option => option.id === selectedId) ? selectedId : ''} onChange={event => selectCore(event.target.value)}><option value="">选择型号查看原表参数</option>{results.map(option => <option key={option.id} value={option.id}>{option.model} · {coreShapeLabel(option.shape)}{option.variants.length > 1 ? ' · ' + option.variants.length + ' 组来源' : ''}</option>)}</select></div>
    <p className="core-audit muted">统一库：{coreLibraryAudit.modelCount} 个具体型号 · {coreLibraryAudit.sourceWorkbookCount} 本来源表 · {coreLibraryAudit.supplementalReferenceCount} 组总表/分表对应 · {coreLibraryAudit.conflictModels.length} 个型号含来源差异</p>
    <div className="core-layout">
      <div className="core-table-wrap"><table className="core-table"><thead><tr><th>型号 / 形状</th><th>材质</th><th>Ae (mm²)</th><th>Aw (mm²)</th><th>AL (nH/N²)</th><th>来源</th></tr></thead><tbody>{results.map(option => <tr key={option.id} className={option.id === selectedId ? 'selected' : ''}><td><button className="link" onClick={() => selectCore(option.id)} aria-label={`查看 ${option.model} 参数`}>{option.model}</button><small className="core-shape">{coreShapeLabel(option.shape)}</small></td><td>{option.materials.join(' / ') || '原表未填写'}</td><td>{summaryValue(option, 'aeMm2')}</td><td>{summaryValue(option, 'awMm2')}</td><td>{summaryValue(option, 'alNhPerTurn2')}</td><td>{option.variants.length} 组{option.conflicts.length > 0 && <span className="core-conflict-tag">差异</span>}</td></tr>)}</tbody></table>{results.length === 0 && <p className="core-empty">没有匹配的具体型号，请调整关键词或筛选条件。</p>}</div>
      <aside className="core-detail" aria-label="磁芯原始参数">{selected ? <>
        <div className="core-detail-heading"><h2>{selected.model}</h2><span className="core-shape-label">{coreShapeLabel(selected.shape)}</span></div>
        <p className="muted">{selected.materials.join(' / ') || '材质原表未填写'} · {selected.variants.length} 组原表来源</p>
        {selected.images.length > 0 ? <div className="core-images">{selected.images.map(image => <figure key={image.id}><a href={image.assetPath} target="_blank" rel="noreferrer"><img src={image.assetPath} alt={image.alt} loading="lazy"/></a><figcaption>{image.binding === 'sheet-series' ? '原表系列示意图；本型号尺寸见对应行' : '原表型号图片'} · {image.sourceLabel || image.sheet}<details><summary>图片对应来源</summary><p>{image.filename} · {image.sheet} · {image.model} · {image.sourceMedia} · {image.anchor || '原表图像'}</p></details></figcaption></figure>)}</div> : <p className="core-image-missing muted">该型号来源未提供可核对的图片。</p>}
        {selected.variants.length > 1 && <label className="core-source-select">参数来源<select aria-label="选择磁芯参数来源" value={selectedVariant?.id ?? ''} onChange={event => setVariantId(event.target.value)}><option value="">并列查看全部来源</option>{selected.variants.map(variant => <option key={variant.id} value={variant.id}>{sourceLabel(variant)}{variant.material ? ' · ' + variant.material : ''}</option>)}</select></label>}
        {selected.conflicts.length > 0 && <div className="core-conflicts"><strong>来源参数有差异</strong><p>不同原表值并列保留。用于设计时可选择具体来源；未选择时只采用各来源一致的参数。</p><div className="core-conflict-table"><table><thead><tr><th>参数</th>{selected.variants.map(variant => <th key={variant.id}>{variant.source.filename}<small>{variant.source.sheet} · 第 {variant.source.row} 行</small></th>)}</tr></thead><tbody>{selected.conflicts.map(conflict => <tr key={conflict.key}><th>{conflict.label}</th>{selected.variants.map(variant => { const value = conflict.values.find(entry => entry.variantId === variant.id); return <td key={variant.id}>{displayCoreValue(value?.value)}{value?.unit && <small>{value.unit}</small>}</td>; })}</tr>)}</tbody></table></div></div>}
        {visibleVariants.map(variant => <details className="core-variant" key={variant.id} open><summary>{sourceLabel(variant)}</summary>{variant.sourceReferences?.map(reference => <p className="muted" key={reference.recordId}>对应分表：{reference.sheet} · 第 {reference.row} 行{reference.cellRange && ' · ' + reference.cellRange}{reference.sourceModel && ' · 原TYPE：' + reference.sourceModel}</p>)}{variant.originalGroup && <p className="muted">原类别：{variant.originalGroup}</p>}{variant.notes.map(note => <p className="core-source-note" key={note}>{note}</p>)}<dl>{variant.rawParameters.map((parameter, index) => <div key={parameter.key + ':' + index}><dt>{parameter.label}{parameter.unit && <small>单位：{parameter.unit}</small>}{!parameter.unit && parameter.key === 'bobbinWidth' && <small>单位：原表未注明</small>}</dt><dd>{displayCoreValue(parameter.value)}{parameter.cell && <small className="muted">{parameter.cell}</small>}</dd></div>)}</dl><details className="core-raw-headers"><summary>原表表头与来源校验</summary><p>来源：{variant.source.filename} · {variant.source.sheet} · 第 {variant.source.row} 行{variant.source.cellRange && ' · ' + variant.source.cellRange}</p>{variant.rawParameters.map((parameter, index) => <p key={parameter.key + ':' + index}><strong>{parameter.label}</strong>：{parameter.rawHeader || '原表表头未注明'}{parameter.cell && ' · ' + parameter.cell}</p>)}<p className="core-hash">SHA256：{variant.source.sha256}</p></details></details>)}
      </> : <p className="muted">选择一个具体型号，查看对应图片、原表参数和来源。</p>}</aside>
    </div>
  </section>;
}