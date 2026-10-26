import type { TransformerDesignDocument } from './types';
import { STEP_LABELS, displayValue, sortedSteps, windingName } from './model';

export function ConnectionPreview({ document }: { document: TransformerDesignDocument }) {
  const steps = sortedSteps(document).filter(step => step.kind === 'winding');
  return <div className="td-illustration">
    <div className="td-pin-reference"><strong>引脚定位</strong><span>视角：{displayValue(document.bobbinSnapshot?.view)}</span><span>1脚：{displayValue(document.bobbinSnapshot?.pin1Location)}</span><p>{document.bobbinSnapshot?.pinDiagramNotes || '排列与实际骨架图待确认；请添加带观察视角与1脚标记的附图。'}</p></div>
    <div className="td-connection-grid">{steps.map(step => <div className="td-connection" key={step.id}>
      <strong>{windingName(document, step.logicalWindingId)} · 工序 {step.order}</strong>
      <svg viewBox="0 0 220 52" role="img" aria-label={'绕线工序' + step.order + '的分段连接示意，同名端见文字说明'}>
        <path d="M12 27 H52 C52 7 72 7 72 27 C72 7 92 7 92 27 C92 7 112 7 112 27 C112 7 132 7 132 27 C132 7 152 7 152 27 H208" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="12" cy="27" r="2.5" fill="white" stroke="currentColor" />
        <circle cx="208" cy="27" r="2.5" fill="white" stroke="currentColor" />
      </svg>
      <div><span>起点 {displayValue(step.fromPin)}</span><span>{step.turns === null ? '匝数待确认' : step.turns + 'T'}</span><span>终点 {displayValue(step.toPin)}</span></div>
      <small>同名端：{displayValue(document.logicalWindings.find(winding => winding.id === step.logicalWindingId)?.polarityNote)}</small>
    </div>)}</div>
    {!steps.length && <p className="td-empty">暂无绕线工序，连接待确认。</p>}
    <p className="td-hint">每条线段对应单个工序，线圈符号不表示实际匝数，端点圆圈仅表示接线端子；未确认极性不绘制同名端圆点，不自动合并N1/N3。</p>
  </div>;
}
export function ProcessPreview({ document }: { document: TransformerDesignDocument }) {
  const steps = sortedSteps(document);
  return <div className="td-process-preview"><p className="td-hint">按工序先后排列；示意非比例。实际内外层、层数及几何厚度以工序文字为准。</p>
    {steps.map(step => <div key={step.id} className={'td-layer td-layer-' + step.kind}><span>{step.order}</span><strong>{STEP_LABELS[step.kind]}</strong><span>{step.kind === 'winding' ? windingName(document, step.logicalWindingId) + ' · ' + (step.turns === null ? '匝数待确认' : step.turns + 'T') : displayValue(step.material)}</span><small>{step.layerNotes || '内外层待确认'}</small></div>)}
    {!steps.length && <p className="td-empty">暂无工序。</p>}
  </div>;
}
