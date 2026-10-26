import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { calculateOpAmp, initialDraft, type OpAmpDraft } from '../algorithm';
import { COMPARATOR_IDS, type ComparatorId } from '../metadata';
import { solveComparator, oscillatorPoint } from './algorithm';
import { ComparatorCharts, comparatorSweep } from './ComparatorCharts';
import { comparatorNotices } from './ComparatorWorkspace';
import { OpAmpPage } from '../OpAmpPage';
import { searchPages } from '../../../navigation/pages';
const solve=(id:ComparatorId,values:Partial<OpAmpDraft['values']>={},memory?:'high'|'low')=>{
  const draft=initialDraft(id);Object.assign(draft.values,values);if(memory)draft.memory=memory;
  const calc=calculateOpAmp(id,draft);if(!calc.ok)throw Error(JSON.stringify(calc.errors));
  return {r:calc.value.comparator!,p:calc.parameters,draft};
};
describe('TI comparator networks and state transitions',()=>{
  it('loads all eight reference defaults without an op amp bandwidth model',()=>{
    expect(COMPARATOR_IDS).toHaveLength(8);
    for(const id of COMPARATOR_IDS){const {r}=solve(id);for(const value of [r.lower,r.upper,r.output,r.high,r.low])expect(Number.isFinite(value)).toBe(true);expect(r.upper).toBeGreaterThanOrEqual(r.lower);}
    expect(initialDraft('undervoltage').memory).toBe('high');
    expect(initialDraft('relaxation').units.c1).toBe(1e-12);
  });
  it('disconnects optional feedback and reproduces 2.5 V or approximately 2.3/2.7 V',()=>{
    const a=solve('comparator').r;expect(a.lower).toBe(2.5);expect(a.upper).toBe(2.5);expect(a.boundary).toBe(true);
    const b=solve('comparator',{hysteresis:'1'}).r;expect(b.lower).toBeCloseTo(2.30031949);expect(b.upper).toBeCloseTo(2.69968051);expect(b.width).toBeCloseTo(.39936102);
    const draft=initialDraft('comparator');draft.values.r3='';expect(calculateOpAmp('comparator',draft).ok).toBe(true);draft.values.hysteresis='1';expect(calculateOpAmp('comparator',draft).ok).toBe(false);
  });
  it('satisfies two independent KCL equations for open-drain inverting high and low states',()=>{
    for(const r1 of ['112','132','150'])for(const r3 of ['1','100','470']) {
      const {r,p}=solve('schmitt-inv',{r1,r3});
      expect((p.vref-r.upper)/p.r1+(p.vee-r.upper)/p.r2+(r.high-r.upper)/p.r4).toBeCloseTo(0,14);
      expect((p.vpu-r.high)/p.r3+(r.upper-r.high)/p.r4).toBeCloseTo(0,14);
      expect((p.vref-r.lower)/p.r1+(p.vee-r.lower)/p.r2+(r.low-r.lower)/p.r4).toBeCloseTo(0,14);
      expect(r.high).toBeLessThan(p.vpu);
    }
    expect(solve('schmitt-inv',{r3:'470'}).r.lower).toBeCloseTo(solve('schmitt-inv',{r3:'1'}).r.lower);
    expect(solve('schmitt-inv',{r3:'470'}).r.upper).not.toBeCloseTo(solve('schmitt-inv',{r3:'1'}).r.upper,4);
  });
  it('solves non-inverting threshold KCL including pull-up loading at the switching input',()=>{
    for(const r1 of ['220','273','330'])for(const r3 of ['10','100','330']) {
      const {r,p}=solve('schmitt-noninv',{r1,r3});
      const atLower=solveComparator('schmitt-noninv',{...p,vin:r.lower},'high');
      expect((r.lower-r.reference)/p.r1+(atLower.high-r.reference)/p.r2).toBeCloseTo(0,14);
      expect((p.vpu-atLower.high)/p.r3+(r.reference-atLower.high)/p.r2).toBeCloseTo(0,14);
      expect((r.upper-r.reference)/p.r1+(r.low-r.reference)/p.r2).toBeCloseTo(0,14);
      expect((p.vref-r.reference)/p.r4+(p.vee-r.reference)/p.r5).toBeCloseTo(0,14);
    }
    const {r}=solve('schmitt-noninv');expect(r.lower).toBeCloseTo(1.29646766);expect(r.upper).toBeCloseTo(1.69626866);
  });
  it.each(['schmitt-inv','schmitt-noninv','undervoltage'] as const)('retains both states inside %s band and switches in both directions',id=>{
    const {r,p}=solve(id),key=id==='undervoltage'?'vcc':'vin',mid=(r.lower+r.upper)/2;
    for(const memory of ['high','low'] as const){const kept=solveComparator(id,{...p,[key]:mid},memory);expect(kept.state).toBe(memory);expect(kept.held).toBe(true);}
    let state=solveComparator(id,{...p,[key]:r.upper+.01},'low');expect(state.state).toBe(r.inverting?'low':'high');
    state=solveComparator(id,{...p,[key]:mid},state.state);expect(state.held).toBe(true);
    state=solveComparator(id,{...p,[key]:r.lower-.01},state.state);expect(state.state).toBe(r.inverting?'high':'low');
    state=solveComparator(id,{...p,[key]:mid},state.state);expect(state.held).toBe(true);
    expect(solveComparator(id,{...p,[key]:r.upper},'low').held).toBe(true);
  });
  it('computes both window taps by ladder current and never treats the window as hysteresis',()=>{
    const {r,p}=solve('window',{r1:'13',r2:'27',r3:'18'}),current=(p.vcc-p.vee)/(p.r1+p.r2+p.r3);
    expect((r.lower-p.vee)/p.r1).toBeCloseTo(current);expect((r.upper-r.lower)/p.r2).toBeCloseTo(current);expect((p.vcc-r.upper)/p.r3).toBeCloseTo(current);
    expect(solveComparator('window',{...p,vin:(r.lower+r.upper)/2},'low').state).toBe('high');
    for(const vin of [r.lower-.01,r.upper+.01])expect(solveComparator('window',{...p,vin},'high').state).toBe('low');
    for(const vin of [r.lower,r.upper])expect(solveComparator('window',{...p,vin}).boundary).toBe(true);
    expect(solve('window',{vpu:'12'}).r.upper).toBeCloseTo(solve('window').r.upper);
  });
  it('ties overvoltage/undervoltage measurement to supply and computes integrated reference thresholds',()=>{
    const over=solve('overvoltage',{vcc:'31'});expect(over.r.upper).toBe(30);expect(over.r.state).toBe('high');expect(over.r.output).toBe(31);expect(over.r.plus).toBeCloseTo(31/3);
    expect(solve('overvoltage',{vcc:'24'}).r.state).toBe('low');
    const under=solve('undervoltage');expect(under.r.lower).toBeCloseTo(1.18*2610/1540);expect(under.r.upper).toBeCloseTo(1.2*2610/1540);
    expect(solve('undervoltage',{vcc:'1.9'}).r.state).toBe('low');expect(solve('undervoltage',{vcc:'2.1'}).r.output).toBe(1.8);
    const below=solve('undervoltage',{vcc:'1'});expect(comparatorNotices('undervoltage',below.p,below.r).some(n=>n.warning&&n.text.includes('工作不保证'))).toBe(true);
  });
  it('converts peak/RMS, attenuates and clamps zero-crossing inputs before reporting common-mode limits',()=>{
    const {r,p}=solve('zero-cross',{vin:'-10'});expect(r.plus).toBeCloseTo(-10/101);expect(r.state).toBe('low');expect(p.amplitude/Math.SQRT2).toBeCloseTo(240);
    expect(solve('zero-cross',{vin:'-100'}).r.plus).toBeCloseTo(-.3);expect(solve('zero-cross',{vin:'10'}).r.state).toBe('high');
    expect(comparatorNotices('zero-cross',p,r).some(n=>n.warning&&n.text.includes('共模'))).toBe(true);
  });
  it('matches exact RC exponential endpoint conditions, period scaling and asymmetric duty',()=>{
    const {r,p}=solve('relaxation'),o=r.oscillator!;
    expect(r.lower).toBeCloseTo(5/3);expect(r.upper).toBeCloseTo(10/3);expect(o.frequency).toBeCloseTo(1/(2*p.r1*p.c1*Math.log(2)));
    expect(o.duty).toBeCloseTo(.5);expect(oscillatorPoint(r,0).capacitor).toBeCloseTo(r.lower);
    expect(r.high+(r.lower-r.high)*Math.exp(-o.highTime/o.tau)).toBeCloseTo(r.upper);
    expect(r.low+(r.upper-r.low)*Math.exp(-o.lowTime/o.tau)).toBeCloseTo(r.lower);
    expect(solve('relaxation',{c1:'200'}).r.oscillator!.frequency).toBeCloseTo(o.frequency/2);
    expect(solve('relaxation',{r2:'10',r3:'40'}).r.oscillator!.duty).not.toBeCloseTo(.5);
    const stopped=solve('relaxation',{voh:'3'}).r;expect(stopped.oscillator!.running).toBe(false);
    expect(Number.isFinite(oscillatorPoint(stopped,1).capacitor)).toBe(true);
  });
  it('validates output levels, pull-up voltage and threshold ordering without requiring GBW',()=>{
    for(const [id,values,key] of [
      ['schmitt-inv',{vpu:'0'},'vpu'],['comparator',{voh:'5'},'voh'],['undervoltage',{vitHigh:'1'},'vitHigh'],['undervoltage',{vitLow:'0'},'vitLow'],['zero-cross',{diodeDrop:'-.1'},'diodeDrop'],['relaxation',{tpd:'-1'},'tpd'],
    ] as const){const draft=initialDraft(id);Object.assign(draft.values,values);const calc=calculateOpAmp(id,draft);expect(calc.ok).toBe(false);if(!calc.ok)expect(calc.errors).toHaveProperty(key);}
    const draft=initialDraft('comparator');draft.values.gbw='';draft.values.headroom='-1';expect(calculateOpAmp('comparator',draft).ok).toBe(true);
  });
  it('builds opposite sweep branches with distinct transition inputs and bounded finite points',()=>{
    const {p,r}=solve('schmitt-inv');const up=comparatorSweep('schmitt-inv',p,0,3,'up'),down=comparatorSweep('schmitt-inv',p,0,3,'down');
    const switchAt=(points:typeof up)=>points.find((pt,i)=>i&&Math.abs(pt.y-points[i-1].y)>1)!.x;
    expect(switchAt(up)).toBeCloseTo(r.upper);expect(switchAt(down)).toBeCloseTo(r.lower);
    for(const id of COMPARATOR_IDS){const {p}=solve(id);for(const direction of ['up','down'] as const)expect(comparatorSweep(id,p,-1,6,direction).every(pt=>Number.isFinite(pt.x)&&Number.isFinite(pt.y))).toBe(true);}
  });
  it('pauses the zero-cross output waveform when the input is fixed exactly at its threshold',()=>{
    const {p,r}=solve('zero-cross',{amplitude:'0',vin:'0'});
    expect(renderToStaticMarkup(<ComparatorCharts id="zero-cross" parameters={p} result={r}/>)).toContain('输出逻辑不确定，已暂停输出波形');
    const valid=solve('zero-cross',{amplitude:'0',vin:'1'});
    expect(renderToStaticMarkup(<ComparatorCharts id="zero-cross" parameters={valid.p} result={valid.r}/>)).not.toContain('输出逻辑不确定，已暂停输出波形');
  });
  it.each([['滞回比较器','schmitt-inv'],['同相施密特','schmitt-noninv'],['chuangkou','window'],['过零','zero-cross'],['guoya','overvoltage'],['qianya','undervoltage'],['chizhang','relaxation']] as const)('searches %s and renders its direct calculator route',(query,id)=>{
    expect(searchPages(query).some(page=>page.page==='opamp'&&page.toolItemId===id)).toBe(true);
    const html=renderToStaticMarkup(<OpAmpPage selectedId={id}/>);expect(html).toContain('计算过程');expect(html).toContain('data-parameter="vcc"');expect(html).not.toContain('GBW');expect(html).not.toMatch(/NaN|Infinity|undefined/);
  });
});
