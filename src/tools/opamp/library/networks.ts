import type { CircuitParameters } from '../algorithm';
import type { LibraryId } from './ids';
import { z, type Network } from './network';
export function libraryNetwork(id:LibraryId,p:CircuitParameters,ac=false):Network {
  const net:Network={fixed:{'0':z(),in:z(ac?1:p.vin),ref:z(ac?0:p.vref),ref2:z(ac?0:p.vi2),vcc:z(ac?0:p.vcc),vee:z(ac?0:p.vee)},branches:[],amps:[],currents:{},output:'out'};
  const r=(a:string,b:string,value:number)=>net.branches.push({a,b,r:value});
  const c=(a:string,b:string,value:number)=>net.branches.push({a,b,c:value});
  const amp=(out:string,plus:string,minus:string)=>net.amps.push({out,plus,minus});
  const bias=(node:string,top:number,bottom:number,source='ref')=>{r(source,node,top);r(node,'0',bottom);};
  if(id==='ac-inv') {c('in','coupled',p.c1);r('coupled','minus',p.r1);r('minus','out',p.r4);bias('plus',p.r2,p.r3);c('plus','0',p.c2);amp('out','plus','minus');}
  if(id==='ac-noninv') {c('in','plus',p.c2);bias('plus',p.r2,p.r3);r('minus','out',p.r4);r('minus','tail',p.r1);c('tail','0',p.c1);amp('out','plus','minus');}
  if(id==='lowpass-inv') {r('in','minus',p.r1);r('minus','out',p.r2);c('minus','out',p.c1);amp('out','0','minus');}
  if(id==='sk-highpass') {c('in','a',p.c1);c('a','plus',p.c2);r('plus','ref',p.r2);r('a','out',p.r1);amp('out','plus','out');}
  if(id==='sk-lowpass') {net.fixed.in=z(ac?1:p.vin+p.vref);r('in','a',p.r1);r('a','plus',p.r2);c('a','out',p.c1);c('plus','0',p.c2);amp('out','plus','out');}
  if(id==='mfb-bandpass') {
    r('in','a',p.r3);r('a','minus',p.r2);r('a','stage1',p.r1);c('a','0',p.c1);c('minus','stage1',p.c2);amp('stage1','ref','minus');
    c('stage1','b',p.c4);c('b','minus2',p.c5);c('b','out',p.c6);r('b','0',p.r4);r('minus2','out',p.r5);amp('out','ref2','minus2');
  }
  if(id==='tia') {r('minus','out',p.r1);c('minus','out',p.c1);amp('out','ref','minus');net.currents.minus=z(ac?-1:-p.iin*1e-6);}
  if(id==='current-uni') {
    net.fixed.shunt=z(ac?p.r1:p.current*p.r1);r('minus','0',p.r2);r('minus','out',p.r3);r('out','0',p.r4);amp('out','shunt','minus');
  }
  if(id==='current-bi') {
    net.currents.shunt=z(ac?-1:-p.current);r('shunt','0',p.rs);bias('reference',p.r5,p.r6,'vcc');amp('buffer','reference','buffer');
    r('shunt','minus',p.r1);r('minus','out',p.r2);r('0','plus',p.r3);r('plus','buffer',p.r4);amp('out','plus','minus');
  }
  if(id==='howland') {
    net.output='load';net.fixed.vn=z(ac?0:p.vi1);net.fixed.vp=z(ac?1:p.vi2);
    r('vn','minus',p.r1);r('minus','drive',p.r2);r('vp','plus',p.r3);r('plus','load',p.r4);r('drive','load',p.rs);r('load','ref',p.rl);amp('drive','plus','minus');
  }
  if(id==='reference') {net.fixed.plus=z(ac?p.alpha:p.vin*p.alpha);r('in','minus',p.r1);r('minus','out',p.r2);amp('out','plus','minus');}
  if(id==='single-diff') {
    net.output='negative';r('in','plus1',p.r5);r('in','0',p.r6);amp('positive','plus1','positive');
    r('positive','minus',p.r1);r('minus','negative',p.r2);bias('plus',p.r3,p.r4);c('plus','0',p.c1);amp('negative','plus','minus');
  }
  if(id==='level-shift') {r('in','plus',p.r3);r('ref','plus',p.r4);r('minus','out',p.r1);r('minus','0',p.r2);amp('out','plus','minus');}
  if(id==='pga') {r('minus','0',p.r1+p.r3);r('minus','out',p.r2);c('minus','out',p.c1);amp('out','in','minus');}
  if(id==='mic-noninv'||id==='mic-tia') {
    r('vcc','mic',p.r1);net.currents.mic=z(ac?-1:-p.biasCurrent*1e-3);
    if(id==='mic-noninv') {
      c('mic','plus',p.c1);bias('plus',p.r2,p.r3,'vcc');c('minus','tail',p.c2);r('tail','0',p.r4);r('minus','internal',p.r5);c('minus','internal',p.c3);amp('internal','plus','minus');
      c('internal','out',p.c4);r('out','0',p.r6);
    }else{
      c('mic','minus',p.c1);bias('plus',p.r2,p.r3,'vcc');c('plus','0',p.c2);r('minus','internal',p.r4);c('minus','internal',p.c3);amp('internal','plus','minus');c('internal','out',p.c4);r('out','0',p.r5);
    }
  }
  return net;
}
