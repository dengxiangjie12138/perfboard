import { describe, expect, it, vi } from 'vitest';
import { calculateOpAmp, initialDraft, type OpAmpDraft } from '../algorithm';
import { LIBRARY_IDS, type LibraryId } from './ids';
import { isSpecial, libraryResponse, rectified, solveLibrary } from './algorithm';
import { libraryNetwork } from './networks';
import { add, magnitude, mul, scale, solveNetwork, z } from './network';
import { pendingParameterDraft, prepareParameterEdit } from '../parameterEdit';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { LibraryCharts } from './LibraryCharts';
import * as libraryAlgorithm from './algorithm';
const fixture=(id:LibraryId,values:Partial<OpAmpDraft['values']>={})=>{
  const d=initialDraft(id);Object.assign(d.values,values);const c=calculateOpAmp(id,d);if(!c.ok)throw Error(id+JSON.stringify(c.errors));return {p:c.parameters,r:c.value.library!,d};
};
describe('remaining TI reference library',()=>{
  it.each(LIBRARY_IDS)('%s has finite default results, metrics and response',id=>{
    const {p,r}=fixture(id);expect(Number.isFinite(r.output)).toBe(true);expect(r.metrics.length).toBeGreaterThan(1);
    expect(r.metrics.every(m=>Number.isFinite(m.value))).toBe(true);
    if(!isSpecial(id))expect(magnitude(libraryResponse(id,p,p.frequency))).toBeGreaterThanOrEqual(0);
  });
  it.each(LIBRARY_IDS.filter(id=>!isSpecial(id)))('%s solves every passive KCL node and amplifier equality at DC and AC with mismatched resistors',id=>{
    const {p}=fixture(id,{r2:'17.13',r4:'6.81'});
    for(const ac of [false,true])for(const freq of ac?[.1,1234,1e6]:[0]){
      const net=libraryNetwork(id,p,ac),v=solveNetwork(net,freq);
      for(const amp of net.amps)expect(magnitude(add(v[amp.plus],scale(v[amp.minus],-1)))).toBeLessThan(1e-7);
      for(const node of Object.keys(v).filter(n=>!net.fixed[n]&&!net.amps.some(a=>a.out===n))){
        let sum=scale(net.currents[node]??z(),-1),total=0;
        for(const b of net.branches){if(b.a!==node&&b.b!==node)continue;const y=b.r?z(1/b.r):z(0,2*Math.PI*freq*b.c!);const current=mul(add(v[node],scale(v[b.a===node?b.b:b.a],-1)),y);sum=add(sum,current);total+=magnitude(current);}
        expect(magnitude(sum)).toBeLessThan(1e-8*Math.max(total,1));
      }
    }
  });
  it('reproduces first-order and both Sallen-Key transfer functions independently',()=>{
    for(const id of ['ac-inv','lowpass-inv','sk-lowpass','sk-highpass'] as const){
      const {p}=fixture(id);for(const f of [1,1000,20000]){
        const w=2*Math.PI*f,h=libraryResponse(id,p,f);let expected;
        if(id==='ac-inv'){const x=w*p.r1*p.c1,k=p.r4/p.r1;expected=z(-k*x*x/(1+x*x),-k*x/(1+x*x));}
        else if(id==='lowpass-inv'){const x=w*p.r2*p.c1,k=p.r2/p.r1;expected=z(-k/(1+x*x),k*x/(1+x*x));}
        else {const a0=1/(p.r1*p.r2*p.c1*p.c2),a1=id==='sk-lowpass'?1/(p.r1*p.c1)+1/(p.r2*p.c1):1/(p.r2*p.c1)+1/(p.r2*p.c2);const a=a0-w*w,b=w*a1,n=id==='sk-lowpass'?a0:-w*w,d=a*a+b*b;expected=z(n*a/d,-n*b/d);}
        expect(h[0]).toBeCloseTo(expected[0],8);expect(h[1]).toBeCloseTo(expected[1],8);
      }
    }
  });
  it('keeps both real poles and the feedback zero of the AC noninverting stage',()=>{
    const {p}=fixture('ac-noninv');for(const f of [1,16,1000]){
      const w=2*Math.PI*f,req=p.r2*p.r3/(p.r2+p.r3),x=w*req*p.c2,y=w*p.r1*p.c1,k=p.r4/p.r1;
      const expected=mul(z(x*x/(1+x*x),x/(1+x*x)),z(1+k*y*y/(1+y*y),k*y/(1+y*y)));
      expect(libraryResponse('ac-noninv',p,f)[0]).toBeCloseTo(expected[0],9);expect(libraryResponse('ac-noninv',p,f)[1]).toBeCloseTo(expected[1],9);
    }
  });
  it('reproduces the cascaded MFB polynomials using all five resistors and five capacitors',()=>{
    const {p}=fixture('mfb-bandpass');for(const f of [100,1000,5000,10000,1e5]){
      const w=2*Math.PI*f,a=1-w*w*p.r1*p.r2*p.c1*p.c2,b=w*p.c2*(p.r1+p.r2+p.r1*p.r2/p.r3),d=a*a+b*b;
      const e=1-w*w*p.r4*p.r5*p.c5*p.c6,g=w*p.r4*(p.c4+p.c5+p.c6),n=w*w*p.r4*p.r5*p.c4*p.c5,dd=e*e+g*g;
      const expected=mul(z(-p.r1/p.r3*a/d,p.r1/p.r3*b/d),z(n*e/dd,-n*g/dd)),h=libraryResponse('mfb-bandpass',p,f);
      expect(h[0]).toBeCloseTo(expected[0],9);expect(h[1]).toBeCloseTo(expected[1],9);
    }
    expect(fixture('mfb-bandpass').r.center).toBeCloseTo(2.5);
  });
  it('matches TI current-sensing examples and actual reference-buffer contribution after mismatch',()=>{
    expect(fixture('tia',{iin:'50'}).r.output).toBeCloseTo(5);
    expect(fixture('current-uni',{current:'1'}).r.output).toBeCloseTo(.25*(1+13300/715));
    const ideal=fixture('current-bi',{current:'1'});expect(ideal.r.output).toBeCloseTo(1.65+.1*20000/1300,3);
    const {p,r}=fixture('current-bi',{r4:'18',r1:'1.5',current:'-.3'}),vp=p.vcc*p.r6/(p.r5+p.r6)*p.r3/(p.r3+p.r4);
    const shunt=(vp-p.current*p.r1)*p.rs/(p.r1+p.rs);
    expect(r.output).toBeCloseTo((1+p.r2/p.r1)*vp-p.r2/p.r1*shunt);
    expect((r.dcNodes.shunt[0]-vp)/p.r1+r.dcNodes.shunt[0]/p.rs+p.current).toBeCloseTo(0,12);
  });
  it('distinguishes Howland load current and shunt current, including feedback loading and mismatch',()=>{
    const {p,r}=fixture('howland');expect(r.output).toBeCloseTo(.02499,4);expect(r.nodes.drive[0]).toBeCloseTo(13,2);
    expect((r.nodes.drive[0]-r.nodes.load[0])/p.rs).toBeCloseTo(r.output+(r.nodes.load[0]-r.nodes.plus[0])/p.r4,10);
    const load=solveLibrary('howland',{...p,rl:1000}),mismatch=solveLibrary('howland',{...p,r4:p.r4*1.05});
    expect(load.output).not.toBe(r.output);expect(mismatch.output).not.toBeCloseTo(r.output,4);
    expect(r.notices.some(n=>n.text.includes('不可作为'))).toBe(false);
    expect(solveLibrary('howland',{...p,r4:100}).notices.some(n=>n.warning&&n.text.includes('正反馈'))).toBe(true);
  });
  it('uses average-value PWM feedback, midpoint carrier timing and off-center reference timing',()=>{
    const {p,r}=fixture('pwm');expect(r.output).toBeCloseTo(1.5);expect(r.duty).toBeCloseTo(.3);expect(r.frequency).toBeCloseTo(p.r6/(4*p.r7*p.r5*p.c3),5);
    const off=solveLibrary('pwm',{...p,vref:2});expect(off.triangleLow).toBeCloseTo(2-3*p.r5/p.r6);expect(off.frequency).not.toBeCloseTo(r.frequency,0);
    expect(fixture('pwm',{vin:'100'}).r.duty).toBe(0);
  });
  it('reproduces reference sweep endpoints and all three oscillator RC phases with unequal components',()=>{
    expect(fixture('reference',{alpha:'0'}).r.output).toBeCloseTo(-10);expect(fixture('reference',{alpha:'1'}).r.output).toBeCloseTo(10);expect(fixture('reference').r.output).toBeCloseTo(5);
    const {p,r}=fixture('sine-osc',{r4:'3.3',c3:'12'}),w=2*Math.PI*r.frequency;
    expect([p.r3*p.c1,p.r4*p.c2,p.r5*p.c3].reduce((s,t)=>s+Math.atan(w*t),0)).toBeCloseTo(Math.PI,10);
    expect(fixture('sine-osc',{r2:'10'}).r.running).toBe(false);
    expect(fixture('sine-osc').r.frequency).toBeCloseTo(Math.sqrt(3)/(2*Math.PI*2700*10e-9),6);
  });
  it('uses peak voltage consistently for the high-voltage current and power calculation',()=>{
    const {r}=fixture('hv-driver');expect(r.amplitude).toBeCloseTo(25.1);expect(r.metrics[0].value).toBeCloseTo(.251);expect(r.metrics[1].value).toBeCloseTo(25.1**2/200);
  });
  it('keeps unequal oscillator time constants accurate beyond atan phase precision',()=>{
    const {p}=fixture('sine-osc');const x={...p,r3:1e-6,c1:1e-15,r4:1e12,c2:1,r5:1e12,c3:1};
    expect(solveLibrary('sine-osc',x).frequency).toBeCloseTo(Math.sqrt(2e9)/(2*Math.PI),6);
  });
  it('does not crash chart rendering when distant frequency samples become ill-conditioned',()=>{
    const {p,r}=fixture('sk-lowpass'),original=libraryAlgorithm.libraryResponse;
    const spy=vi.spyOn(libraryAlgorithm,'libraryResponse').mockImplementation((id,p,f)=>{if(f>1e5)throw Error('Ill-conditioned sample');return original(id,p,f);});
    try{const html=renderToStaticMarkup(createElement(LibraryCharts,{id:'sk-lowpass',parameters:p,result:r}));expect(html).toContain('响应与曲线');expect(html).toContain('部分采样点数值病态');expect(html).not.toMatch(/NaN|Infinity/);}finally{spy.mockRestore();}
  });
  it('preserves each rectifier half-cycle, unbalanced full-wave gain and compensation role',()=>{
    const {p}=fixture('full-wave',{r2:'2'});for(const input of [-2,0,2])expect(rectified('full-wave',p,input)).toBe(input>=0?input:-2*input);
    expect(fixture('half-wave',{vin:'-.2'}).r.output).toBeCloseTo(.2);expect(fixture('half-wave',{vin:'.2'}).r.output).toBeCloseTo(0);
  });
  it('checks single-ended differential outputs, positive reference shift and zero-ohm PGA',()=>{
    const {r}=fixture('single-diff');expect(r.output).toBeCloseTo(.5);expect(r.dcNodes.positive[0]).toBeCloseTo(1.5);expect(r.dcNodes.negative[0]).toBeCloseTo(1);
    const {p,r:shift}=fixture('level-shift');expect(shift.output).toBeCloseTo((p.vin*p.r4+p.vref*p.r3)/(p.r3+p.r4)*(1+p.r1/p.r2));
    const {p:pg}=fixture('pga',{r1:'0'});expect(libraryResponse('pga',pg,0)[0]).toBeCloseTo(1001);expect(magnitude(libraryResponse('pga',pg,1e12))).toBeCloseTo(1,6);
  });
  it('uses RMS microphone conversion, complete AC coupling and internal DC bias',()=>{
    for(const id of ['mic-noninv','mic-tia'] as const){const {p,r}=fixture(id);expect(r.output).toBeGreaterThan(1.15);expect(r.output).toBeLessThan(1.25);expect(r.center).toBeCloseTo(0);expect(r.dcNodes.internal[0]).toBeCloseTo(2.5);expect(r.dcNodes.mic[0]).toBeCloseTo(2.05);expect(solveLibrary(id,{...p,pressure:4}).output).toBeCloseTo(2*r.output);expect(magnitude(libraryResponse(id,p,1))).toBeLessThan(magnitude(libraryResponse(id,p,1000)));}
  });
  it.each(LIBRARY_IDS)('%s pending input and units do not modify the applied draft until confirmed',id=>{
    const {d}=fixture(id);const before=JSON.stringify(d),key='vin';const pending={value:'2.'};
    pendingParameterDraft(d,key,pending);expect(JSON.stringify(d)).toBe(before);
    const prepared=prepareParameterEdit(id,d,key,pending);expect(prepared.ok).toBe(true);expect(JSON.stringify(d)).toBe(before);
  });
  it('rejects impossible reference, pot positions, negative passives and singular networks',()=>{
    for(const [id,key,value] of [['reference','alpha','1.1'],['pwm','vref','0'],['mic-tia','micZ','0'],['mic-noninv','pressure','-1'],['sk-lowpass','c2','-1'],['pga','r3','0']] as const){const d=initialDraft(id);d.values[key]=value;expect(calculateOpAmp(id,d).ok).toBe(false);}
    expect(()=>solveNetwork({fixed:{'0':z()},branches:[{a:'floating',b:'0',c:1e-9}],amps:[],currents:{},output:'floating'},0)).toThrow();
  });
});
