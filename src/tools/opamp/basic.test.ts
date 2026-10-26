import { describe, expect, it } from 'vitest';
import { calculateOpAmp, circuitNotices, dcTransfer, initialDraft, matchingDraft, type OpAmpDraft } from './algorithm';
import { frequencyResponse, sinePoint } from './dynamic';
import { CIRCUITS, isComparatorCircuit, isLibraryCircuit, isDynamicCircuit, type CircuitId, type ParameterKey } from './metadata';
const solve = (id:CircuitId, values:Partial<OpAmpDraft['values']>={})=>{
  const draft=initialDraft(id); Object.assign(draft.values,values); const result=calculateOpAmp(id,draft);
  if(!result.ok) throw Error(JSON.stringify(result.errors)); return {...result,draft};
};
describe('complete TI basic amplifier and arithmetic group',()=>{
  it('covers every registered circuit with valid reference defaults',()=>{
    const basic=CIRCUITS.filter(c=>!isComparatorCircuit(c.id)&&!isLibraryCircuit(c.id));expect(basic).toHaveLength(9);
    for(const circuit of basic){ const {value:r}=solve(circuit.id);expect(Number.isFinite(r.output)).toBe(true);expect(r.noiseGain).toBeGreaterThan(0); }
  });
  it('computes a unity follower and signed inverting gain using noise gain for bandwidth',()=>{
    expect(solve('follower',{vin:'-2.2'}).value.output).toBeCloseTo(-2.2);
    const {value:r}=solve('inv');expect(r.output).toBeCloseTo(-1);expect(r.gain).toBeCloseTo(-2);expect(r.noiseGain).toBe(3);expect(r.bandwidth).toBeCloseTo(400000);
    expect(solve('inv',{r2:'50'}).value.output).toBeCloseTo(-2.5);
  });
  it('solves summing-node KCL, independent channel gains and parallel-input noise gain',()=>{
    for(const vi1 of [-2,0,.7]) for(const vi2 of [-.2,.2]) {
      const {value:r,parameters:p}=solve('sum',{vi1:String(vi1),vi2:String(vi2),r1:'11',r2:'3.3',r3:'22'});
      expect(p.vi1/p.r1+p.vi2/p.r2+r.output/p.r3).toBeCloseTo(0,12);
      expect(r.noiseGain).toBeCloseTo(1+p.r3*(1/p.r1+1/p.r2));
    }
    expect(solve('sum').value.output).toBeCloseTo(-1.951219512);
  });
  it('solves both two-amplifier KCL equations across mismatched resistors and references',()=>{
    for(const r1 of ['3.3','5.1']) for(const r2 of ['18','20']) for(const r3 of ['4.7','5.1']) for(const r4 of ['20','22']) for(const rg of ['1','7.87']) {
      const {value:r,parameters:p}=solve('ina2',{r1,r2,r3,r4,rg,vi1:'1.3',vi2:'1.7',vref:'.4'}), va=r.internalOutputs[0].value;
      expect((p.vi1-p.vref)/p.r4+(p.vi1-va)/p.r3+(p.vi1-p.vi2)/p.rg).toBeCloseTo(0,12);
      expect((p.vi2-va)/p.r1+(p.vi2-r.output)/p.r2+(p.vi2-p.vi1)/p.rg).toBeCloseTo(0,12);
      expect(r.output).toBeCloseTo(r.gain*r.vdiff+r.commonGain*r.vcm+r.aRef*p.vref,9);
    }
  });
  it('reproduces matched two-amplifier gain and reference gain, and exposes hidden internal clipping',()=>{
    const {value:r,parameters:p}=solve('ina2');expect(r.gain).toBeCloseTo(1+p.r4/p.r3+2*p.r2/p.rg);expect(r.aRef).toBeCloseTo(1);expect(r.output).toBeCloseTo(r.gain);
    const hidden=solve('ina2',{vi1:'12',vi2:'12'});expect(hidden.value.output).toBeCloseTo(0);
    expect(circuitNotices('ina2',hidden.parameters,hidden.value).some(n=>n.warning && n.text.includes('内部输出'))).toBe(true);
  });
  it('solves all four three-amplifier KCL nodes with independently changed R5/R6 and mismatched output ratios',()=>{
    for(const r1 of ['7.5','10']) for(const r4 of ['10','22']) for(const r5 of ['10','12']) for(const r6 of ['8.2','10']) {
      const {value:r,parameters:p}=solve('ina3',{r1,r4,r5,r6,r10:'3.3',vi1:'-.3',vi2:'.6',vref:'.8'}),[a,b]=r.internalOutputs.map(n=>n.value);
      expect((p.vi1-a)/p.r6+(p.vi1-p.vi2)/p.r10).toBeCloseTo(0,12);
      expect((p.vi2-b)/p.r5+(p.vi2-p.vi1)/p.r10).toBeCloseTo(0,12);
      expect((r.vplus-a)/p.r1+(r.vplus-r.output)/p.r2).toBeCloseTo(0,12);
      expect((r.vplus-b)/p.r3+(r.vplus-p.vref)/p.r4).toBeCloseTo(0,12);
      expect(r.output).toBeCloseTo(r.gain*r.vdiff+r.commonGain*r.vcm+r.aRef*p.vref,9);
    }
  });
  it('matches the three-amplifier reference and preserves common-mode rejection with unequal front feedbacks',()=>{
    const {value:r,parameters:p}=solve('ina3');expect(r.gain).toBeCloseTo(1+20000/2210);expect(r.output).toBeCloseTo(.5*r.gain);
    const changed=solve('ina3',{r5:'20',r6:'8.2',vi1:'1',vi2:'1',vref:'.4'});expect(changed.value.output).toBeCloseTo(.4);expect(changed.value.commonGain).toBeCloseTo(0);
    expect(r.gain).toBeCloseTo(p.r2/p.r1*(1+(p.r5+p.r6)/p.r10));
  });
  it.each<CircuitId>(['diff','ina2','ina3'])('changes only R4 when matching %s',id=>{
    const {draft}=solve(id,{r4:'22'}),matched=matchingDraft(draft)!;
    expect(draft.values.r4).toBe('22'); expect(matched.values.r1).toBe(draft.values.r1);expect(matched.values.rg).toBe(draft.values.rg);
    const result=calculateOpAmp(id,matched);expect(result.ok && result.value.matched).toBe(true);
  });
  it('has consistent transfer-chart working points for every DC circuit, including negative gains and independent sum inputs',()=>{
    for(const c of CIRCUITS.filter(c=>!isDynamicCircuit(c.id)&&!isComparatorCircuit(c.id)&&!isLibraryCircuit(c.id))) {const {value:r,parameters:p}=solve(c.id),t=dcTransfer(c.id,p,r);expect(t.gain*t.input+t.offset).toBeCloseTo(r.output,9);}
  });
});
describe('practical integrator and differentiator frequency/time calculations',()=>{
  it('uses the finite DC-feedback integrator and its actual pole rather than a divergent DC idealization',()=>{
    const {value:r,parameters:p}=solve('integrator');expect(r.dynamic!.tau).toBeCloseTo(.159);expect(r.dynamic!.magnitude).toBeCloseTo(1.000973985,6);
    expect(frequencyResponse('integrator',p,0).real).toBeCloseTo(-1000);expect(frequencyResponse('integrator',p,0).imag).toBe(0);
    expect(solve('integrator',{vin:'.001'}).value.output).toBeCloseTo(-1);
  });
  it('satisfies complex feedback-node KCL for the integrator over five decades',()=>{
    const {parameters:p}=solve('integrator');
    for(const freq of [.1,1,100,1000,1e5]) {const h=frequencyResponse('integrator',p,freq),b=2*Math.PI*freq*p.c1;
      expect(-1/p.r1-h.real/p.r2+h.imag*b).toBeCloseTo(0,12);
      expect(-h.imag/p.r2-h.real*b).toBeCloseTo(0,12);}
  });
  it('uses the differentiator input resistance, finite DC output, correct phase and GBW condition',()=>{
    const {value:r,parameters:p}=solve('differentiator');expect(r.output).toBe(2.5);expect(r.dynamic!.phase).toBeLessThan(-90);expect(r.dynamic!.phase).toBeGreaterThan(-180);
    expect(r.dynamic!.magnitude).toBeCloseTo(2*Math.PI*2500*499000*15e-9/Math.hypot(1,2*Math.PI*2500*1000*15e-9));
    expect(r.dynamic!.minimumGbw).toBeCloseTo((p.r1+p.r2)/(2*Math.PI*p.r1*p.r1*p.c1));expect(frequencyResponse('differentiator',p,0).magnitude).toBe(0);
  });
  it('satisfies complex current balance with an optional feedback capacitor',()=>{
    const {parameters:p}=solve('differentiator',{cf:'100'});
    for(const freq of [10,100,2500,1e5]) {const h=frequencyResponse('differentiator',p,freq),xc=1/(2*Math.PI*freq*p.c1),den=p.r1*p.r1+xc*xc;
      const inputReal=-p.r1/den,inputImag=-xc/den,feedbackG=1/p.r2,feedbackB=2*Math.PI*freq*p.cf;
      expect(inputReal-h.real*feedbackG+h.imag*feedbackB).toBeCloseTo(0,12);
      expect(inputImag-h.imag*feedbackG-h.real*feedbackB).toBeCloseTo(0,12);}
  });
  it('converts capacitor units independently and permits only Cf to be disconnected',()=>{
    const {draft}=solve('integrator');draft.values.c1='.00159';draft.units.c1=1e-6;
    const r=calculateOpAmp('integrator',draft);expect(r.ok && r.value.dynamic!.tau).toBeCloseTo(.159);
    expect(calculateOpAmp('differentiator',initialDraft('differentiator')).ok).toBe(true);
  });
  it.each<[CircuitId,ParameterKey,string]>([['integrator','c1','0'],['differentiator','cf','-1'],['integrator','frequency','0'],['differentiator','amplitude','-.1'],['ina3','r10','0'],['ina2','rg','']])('rejects invalid %s %s=%s without stale results',(id,key,raw)=>{
    const d=initialDraft(id);d.values[key]=raw;const r=calculateOpAmp(id,d);expect(!r.ok && r.errors[key]).toBeTruthy();
  });
  it('generates exact steady-state sine/quadrature values, including zero-amplitude DC',()=>{
    const {value:r,parameters:p}=solve('integrator'),d=r.dynamic!;
    expect(sinePoint(p,d,0).output).toBeCloseTo(d.outputDC+p.amplitude*d.imag);
    expect(sinePoint(p,d,1/(4*p.frequency)).output).toBeCloseTo(d.outputDC+p.amplitude*d.real);
    const zero=solve('differentiator',{amplitude:'0'});expect(sinePoint(zero.parameters,zero.value.dynamic!,1).output).toBe(2.5);
  });
  it('checks the complete AC envelope and low-GBW/stability conditions',()=>{
    const v=solve('differentiator',{amplitude:'1',gbw:'1'}),notices=circuitNotices('differentiator',v.parameters,v.value);
    expect(notices.some(n=>n.warning && n.text.includes('稳态包络'))).toBe(true);expect(notices.some(n=>n.warning && n.text.includes('GBW 设计条件'))).toBe(true);
  });
});
