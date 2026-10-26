import type { CircuitParameters } from '../algorithm';
import type { ParameterKey } from '../metadata';
import type { LibraryId } from './ids';
import { libraryNetwork } from './networks';
import { magnitude, scale, solveNetwork, type Complex } from './network';
export interface Metric { label:string;value:number;unit:string }
export interface LibraryResult {
  output:number;gain:number;phase:number;amplitude:number;center:number;frequency:number;
  metrics:Metric[];notices:{warning:boolean;text:string}[];nodes:Record<string,Complex>;
  dcNodes:Record<string,Complex>;acNodes:Record<string,Complex>;running:boolean;duty:number;triangleLow:number;triangleHigh:number;
}
export const isAudio=(id:LibraryId)=>id==='mic-noninv'||id==='mic-tia';
export const isAC=(id:LibraryId)=>['ac-inv','ac-noninv','lowpass-inv','sk-highpass','sk-lowpass','mfb-bandpass','pga','single-diff','mic-noninv','mic-tia','tia','hv-driver'].includes(id);
export const isSpecial=(id:LibraryId)=>['pwm','sine-osc','half-wave','full-wave','hv-driver'].includes(id);
const pole=(r:number,c:number)=>1/(2*Math.PI*r*c);
export function libraryResponse(id:LibraryId,p:CircuitParameters,frequency:number):Complex {
  if(id==='hv-driver') {const w=2*Math.PI*frequency*p.rf*p.cf;return [1+p.rf/p.rg/(1+w*w),-p.rf/p.rg*w/(1+w*w)];}
  const net=libraryNetwork(id,p,true),v=solveNetwork(net,frequency);
  return id==='single-diff'?[v.positive[0]-v.negative[0],v.positive[1]-v.negative[1]]:id==='howland'?scale(v[net.output],1/p.rl):v[net.output];
}
export function rectified(id:'half-wave'|'full-wave',p:CircuitParameters,input:number):number {
  return id==='half-wave'?Math.max(0,-input*p.r4/p.r1):input>=0?input:-input*p.r2/p.r1;
}
export function solveLibrary(id:LibraryId,p:CircuitParameters):LibraryResult {
  const result:LibraryResult={output:0,gain:0,phase:0,amplitude:0,center:0,frequency:p.frequency,metrics:[],notices:[],nodes:{},dcNodes:{},acNodes:{},running:true,duty:0,triangleLow:0,triangleHigh:0};
  const metric=(label:string,value:number,unit='V')=>result.metrics.push({label,value,unit});
  const notice=(warning:boolean,text:string)=>result.notices.push({warning,text});
  if(!isSpecial(id)) {
    const dc=libraryNetwork(id,p),ac=libraryNetwork(id,p,true),v=solveNetwork(dc,0),h=solveNetwork(ac,p.frequency);
    result.dcNodes=v;result.acNodes=h;result.nodes=v;
    const transfer=libraryResponse(id,p,p.frequency);
    result.output=id==='single-diff'?v.positive[0]-v.negative[0]:id==='howland'?(v.load[0]-p.vref)/p.rl:v[dc.output][0];
    result.center=result.output;result.gain=magnitude(transfer);result.phase=Math.atan2(transfer[1],transfer[0])*180/Math.PI;
    result.amplitude=result.gain*(isAudio(id)?Math.pow(10,p.sensitivity/20)/p.micZ*p.pressure:id==='tia'?Math.abs(p.iin)*1e-6:p.amplitude);
    if(isAudio(id)){result.output=result.amplitude;metric('麦克风电流 RMS',Math.pow(10,p.sensitivity/20)/p.micZ*p.pressure*1e6,'µA');metric('麦克风偏置电压',v.mic[0]);metric('运放内部直流输出',v.internal[0]);metric('内部输出峰值',magnitude(h.internal)*Math.pow(10,p.sensitivity/20)/p.micZ*p.pressure*Math.SQRT2);}
    if(id==='tia'){metric('跨阻直流增益',p.r1,'V/A');metric('反馈极点',pole(p.r1,p.c1),'Hz');metric('稳定性所需 GBW 下限',(p.ci+p.c1)/(2*Math.PI*p.r1*p.c1*p.c1),'Hz');notice(p.gbw*1e6<result.metrics[2].value,'Ci 仅用于 TI 的 GBW 稳定性下限估算；源电容和运放寄生未纳入理想传递曲线。');}
    if(id==='ac-inv'){metric('通带增益',-p.r4/p.r1,'V/V');metric('输入高通极点',pole(p.r1,p.c1),'Hz');metric('基准去耦极点',pole(p.r2*p.r3/(p.r2+p.r3),p.c2),'Hz');}
    if(id==='ac-noninv'){metric('高频通带增益',1+p.r4/p.r1,'V/V');metric('反馈支路极点',pole(p.r1,p.c1),'Hz');metric('输入耦合极点',pole(p.r2*p.r3/(p.r2+p.r3),p.c2),'Hz');}
    if(id==='lowpass-inv'){metric('直流增益',-p.r2/p.r1,'V/V');metric('低通极点',pole(p.r2,p.c1),'Hz');}
    if(id==='sk-lowpass'||id==='sk-highpass'){
      const w0=1/Math.sqrt(p.r1*p.r2*p.c1*p.c2),a1=id==='sk-lowpass'?1/(p.r1*p.c1)+1/(p.r2*p.c1):1/(p.r2*p.c1)+1/(p.r2*p.c2);
      metric('固有频率 f0（不总等于 −3dB）',w0/(2*Math.PI),'Hz');metric('品质因数 Q',w0/a1,'');
      const q=w0/a1,b=2-1/(q*q),lp=Math.sqrt((b+Math.sqrt(b*b+4))/2);
      metric('相对通带 −3dB 频率',w0/(2*Math.PI)*(id==='sk-lowpass'?lp:1/lp),'Hz');
    }
    if(id==='mfb-bandpass') {
      const wL=1/Math.sqrt(p.r1*p.r2*p.c1*p.c2),wH=1/Math.sqrt(p.r4*p.r5*p.c5*p.c6);
      metric('LP 固有频率',wL/(2*Math.PI),'Hz');metric('LP 品质因数',1/(wL*p.c2*(p.r1+p.r2+p.r1*p.r2/p.r3)),'');
      metric('HP 固有频率',wH/(2*Math.PI),'Hz');metric('HP 品质因数',1/(wH*p.r4*(p.c4+p.c5+p.c6)),'');metric('第一级直流输出',v.stage1[0]);
    }
    if(id==='current-uni'||id==='current-bi'){const rs=id==='current-uni'?p.r1:p.rs;metric('分流节点电压（对地）',v.shunt[0]);metric('分流电阻功耗',v.shunt[0]**2/rs,'W');metric('电流转换增益',libraryResponse(id,p,0)[0],'V/A');if(id==='current-bi'){metric('缓冲基准',v.buffer[0]);notice(Math.abs(p.r2/p.r1-p.r4/p.r3)>1e-8,'差分电阻失配时已采用完整分压与反馈方程，不再使用匹配增益简式。');}else notice(p.current<0,'单向参考电路面向正向电流；负电流的理想输出可能超出单电源可用摆幅。');}
    if(id==='howland') {
      metric('运放驱动输出',v.drive[0]);metric('负载电压',v.load[0]);metric('分流电流',(v.drive[0]-v.load[0])/p.rs*1000,'mA');metric('负载电流',result.output*1000,'mA');metric('反馈支路电流',(v.load[0]-v.plus[0])/p.r4*1e6,'µA');metric('负载功耗',result.output*result.output*p.rl,'W');
      const loop=(1+p.r2/p.r1)*p.r3/(p.r3+p.r4),passive=1+p.rs/p.rl+p.rs/(p.r3+p.r4);
      notice(loop>=passive,loop>=passive?'正反馈达到或超过负反馈，直流平衡不稳定，当前理想解不可作为可用工作点。':'当前负反馈强于正反馈；已计入支路负载，仍需核对器件输出能力与实际稳定性。');
    }
    if(id==='reference'){metric('同相输入',p.alpha*p.vin);metric('电位器电流',p.vin/p.rp*1000,'mA');metric('电位器功耗',p.vin*p.vin/p.rp,'W');metric('输入参考源总电流',(p.vin/p.rp+(p.vin-v.minus[0])/p.r1)*1000,'mA');}
    if(id==='single-diff'){metric('Vo+',v.positive[0]);metric('Vo−',v.negative[0]);metric('输出共模',(v.positive[0]+v.negative[0])/2);metric('输入下拉电流',p.vin/p.r6*1e6,'µA');metric('参考滤波极点',pole(p.r3*p.r4/(p.r3+p.r4),p.c1),'Hz');notice(false,'R5 在零偏置电流理想模型中没有直流压降；R6 决定输入负载，C1 只滤除基准扰动。');}
    if(id==='level-shift'){metric('输入系数', (1+p.r1/p.r2)*p.r4/(p.r3+p.r4),'V/V');metric('基准系数',(1+p.r1/p.r2)*p.r3/(p.r3+p.r4),'V/V');metric('输入到参考电流',(p.vin-p.vref)/(p.r3+p.r4)*1e6,'µA');}
    if(id==='pga'){metric('直流增益',1+p.r2/(p.r1+p.r3),'V/V');metric('反馈阻抗极点',pole(p.r2,p.c1),'Hz');metric('R1=0 时最大直流增益',1+p.r2/p.r3,'V/V');notice(false,'高频理想增益趋近 1，并非趋近 0；实际高频衰减与最大增益带宽受运放 GBW 限制。');}
  }else if(id==='half-wave'||id==='full-wave') {
    result.output=rectified(id,p,p.vin);result.center=result.output;result.gain=id==='half-wave'?p.r4/p.r1:p.r2/p.r1;
    metric('正输入半周增益',id==='half-wave'?0:1,'V/V');metric('负输入半周增益',id==='half-wave'?-p.r4/p.r1:-p.r2/p.r1,'V/V');
    metric('输入最大 / 最小值',p.vin+p.amplitude);metric('输入最小值',p.vin-p.amplitude);
    if(id==='full-wave'){metric('R3 正半周电流',Math.max(p.vin,0)/p.r3*1000,'mA');metric('补偿时间常数',p.r1*p.c1*1e9,'ns');}
    notice(false,'曲线为理想二极管的逐点静态映射，未模拟二极管恢复、运放内部摆幅、转换速度和过零失真。');
  }else if(id==='pwm') {
    const bias=p.vref*p.r2/(p.r1+p.r2),target=(1+p.r4/p.r3)*bias-p.r4/p.r3*p.vin;
    result.duty=Math.max(0,Math.min(1,(target-p.vee)/(p.vcc-p.vee)));result.output=p.vee+result.duty*(p.vcc-p.vee);result.center=result.output;
    result.triangleLow=p.vref+(p.vref-p.vcc)*p.r5/p.r6;result.triangleHigh=p.vref+(p.vref-p.vee)*p.r5/p.r6;
    const width=result.triangleHigh-result.triangleLow;
    result.running=p.vref>p.vee&&p.vref<p.vcc;
    result.frequency=result.running?1/(width*p.r7*p.c3*(1/(p.vcc-p.vref)+1/(p.vref-p.vee))):0;
    metric('占空比 D',result.duty*100,'%');metric('理想载波频率',result.frequency,'Hz');metric('三角波下限',result.triangleLow);metric('三角波上限',result.triangleHigh);metric('闭环目标平均电压',target);metric('误差环路极点',pole(p.r4,p.c1),'Hz');metric('基准去耦极点',pole(p.r1*p.r2/(p.r1+p.r2),p.c2),'Hz');
    notice(target<=p.vee||target>=p.vcc,'平均值闭环目标超出输出电平时，占空比受限到 0% 或 100%；此时调制不再线性。');
    notice(result.triangleLow<p.vee+p.headroom||result.triangleHigh>p.vcc-p.headroom,'三角波必须处于积分运放可用摆幅内；超限时频率和 PWM 仅为理想估算。');
  }else if(id==='sine-osc') {
    const taus=[p.r3*p.c1,p.r4*p.c2,p.r5*p.c3];
    // Im Π(1+jωτi)=0 gives ω²=Στi/Πτi; avoids atan rounding near π for unequal RCs.
    const w=Math.sqrt(taus.reduce((sum,t)=>sum+t,0)/taus.reduce((product,t)=>product*t,1)),required=taus.reduce((s,t)=>s*Math.hypot(1,w*t),1),gain=p.r2/p.r1;
    result.frequency=w/(2*Math.PI);result.running=gain>=required*(1-1e-10);result.output=result.frequency;result.gain=gain/required;result.amplitude=p.amplitude;
    metric('反相级增益幅值',gain,'V/V');metric('维持振荡所需增益',required,'V/V');metric('环路增益幅值',gain/required,'');metric('幅值示意假设',p.amplitude,'Vpk');
    notice(!result.running,!result.running?'环路增益小于 1，振荡会衰减，已暂停正弦输出示意。':'环路增益达到维持条件；理想线性模型不能确定稳态幅值，示意采用手动设置的 Vp。');
  }else if(id==='hv-driver') {
    const dcGain=1+p.rf/p.rg,h=libraryResponse(id,p,p.frequency);result.output=p.vin*dcGain;result.center=result.output;result.gain=magnitude(h);result.phase=Math.atan2(h[1],h[0])*180/Math.PI;result.amplitude=result.gain*p.amplitude;
    metric('输出峰值电流',result.amplitude/p.rl,'A');metric('正弦负载平均功率',result.amplitude**2/(2*p.rl),'W');metric('直流负载功率',result.output**2/p.rl,'W');metric('Vdrive=0 时上管偏置 VGS',p.vcc*p.r3/(p.r2+p.r3));metric('Vdrive=0 时下管偏置 |VGS|',-p.vee*p.r4/(p.r4+p.r5));metric('Vdrive=0 时上臂偏置电流',p.vcc/(p.r2+p.r3)*1000,'mA');metric('Vdrive=0 时下臂偏置电流',-p.vee/(p.r4+p.r5)*1000,'mA');metric('RZCO 每伏压差电流',1/p.rz*1000,'mA/V');
    metric('最差平均单管耗散估算（对称电源）',2*Math.max(Math.abs(p.vcc),Math.abs(p.vee))**2/(Math.PI**2*p.rl),'W');
    notice(false,'晶体管阈值、交越失真、稳定性、限流与温升未建模。输入串联 R1 在理想零偏置输入下不改变电压增益，MOSFET 偏置结果仅用于核对。');
  }
  return result;
}
export function libraryValidation(id:LibraryId,p:CircuitParameters):Partial<Record<ParameterKey,string>> {
  const errors:Partial<Record<ParameterKey,string>>={};
  if(id==='reference'&&(p.alpha<0||p.alpha>1))errors.alpha='α 必须在 0 到 1 之间。';
  if(isAudio(id)) {if(p.pressure<0)errors.pressure='声压 RMS 不能为负数。';if(p.micZ<1e-6)errors.micZ='测试阻抗最小为 1 µΩ。';if(p.biasCurrent<0)errors.biasCurrent='偏置电流不能为负数。';if(p.sensitivity>40||p.sensitivity< -200)errors.sensitivity='本工具支持 −200 到 40 dBV。';}
  if(id==='pwm'&&(p.vref<=p.vee||p.vref>=p.vcc))errors.vref='三角波参考必须严格位于供电轨之间。';
  try {if(!Object.keys(errors).length)solveLibrary(id,p);}catch(error){errors[id==='howland'?'r4':'r1']=error instanceof Error?error.message:'网络无法求解';}
  return errors;
}
