import {useEffect,useRef,useState} from 'react';
import {isTauri} from '@tauri-apps/api/core';
import {activityLogApi,type ActivityDay,type ActivityDays,type ActivitySegment} from '../../services/activityLogApi';
import './activity-log.css';
import {RowLimitedTable} from '../../components/RowLimitedTable';
export function localDay(date=new Date()){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');}
export function duration(ms:number){const sec=Math.max(0,Math.floor(ms/1000));return [Math.floor(sec/3600),Math.floor(sec/60)%60,sec%60].map(v=>String(v).padStart(2,'0')).join(':');}
export function endpoint(stamp:number,offset:number|undefined,day:string){
 const date=offset===undefined?new Date(stamp):new Date(stamp+offset*60_000);
 const h=offset===undefined?date.getHours():date.getUTCHours();
 const m=offset===undefined?date.getMinutes():date.getUTCMinutes();
 const s=offset===undefined?date.getSeconds():date.getUTCSeconds();
 const calendar=offset===undefined?localDay(date):[date.getUTCFullYear(),String(date.getUTCMonth()+1).padStart(2,'0'),String(date.getUTCDate()).padStart(2,'0')].join('-');
 return (calendar===day?'':calendar+' ')+[h,m,s].map(v=>String(v).padStart(2,'0')).join(':');
}
const modes={off:'已关闭',working:'工作',resting:'休息',systemRest:'锁屏 / 睡眠休息',paused:'会议暂停'};
const reasons={idle:'无操作确认',manual:'手动休息',system:'系统',control:'设置 / 控制',restart:'重新启动'};
export function ActivityLogDayTable(){
 const [day,setDay]=useState(()=>localDay()),[data,setData]=useState<ActivityDay|null>(null),[days,setDays]=useState<ActivityDays['days']>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const sequence=useRef(0),followToday=useRef(true);
 useEffect(()=>{
  const token=++sequence.current;let alive=true,reading=false,again=false,cleanup:(()=>void)|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  async function refresh(){
   if(reading){again=true;return;}reading=true;setBusy(true);
   try{const [record,list]=await Promise.all([activityLogApi.day(day),activityLogApi.days({limit:366})]);if(alive&&token===sequence.current){setData(record);setDays(list.days);setError('');}}
   catch(e){if(alive&&token===sequence.current)setError(String(e));}
   finally{reading=false;if(alive&&token===sequence.current){setBusy(false);if(again){again=false;void refresh();}}}
  }
  if(isTauri()){
   void activityLogApi.listenChanged(changed=>{if(changed!==day)return;clearTimeout(timer);timer=setTimeout(()=>void refresh(),250);}).then(fn=>{if(!alive)fn();else cleanup=fn;}).catch(e=>{if(alive)setError(String(e));});
  }
  void refresh();
  const interval=setInterval(()=>{const today=localDay();if(followToday.current&&today!==day)setDay(today);else void refresh();},15_000);
  return()=>{alive=false;sequence.current++;cleanup?.();clearTimeout(timer);clearInterval(interval);};
 },[day,revision]);
 function choose(next:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(next))return;followToday.current=next===localDay();setDay(next);}
 function step(n:number){const date=new Date(day+'T12:00:00');date.setDate(date.getDate()+n);choose(localDay(date));}
 const view=data?.day===day?data:null;
 function row(segment:ActivitySegment){return <tr key={segment.id}><td>{endpoint(segment.startUtcMs,segment.startOffsetMinutes,day)}</td><td>{endpoint(segment.endUtcMs,segment.endOffsetMinutes,day)}</td><td>{modes[segment.mode]}</td><td>{reasons[segment.reason]}</td><td>{duration(segment.durationMs)}</td><td>{segment.incomplete?'未完整确认':segment.ongoing?'进行中（截至最近确认）':'已结束'}</td></tr>;}
 return <section className="activity-log" aria-label="每日工作休息记录"><header><div><h3>每日工作休息记录</h3><p>按本机日期查看工作、休息和系统离开时段。</p></div><button disabled={busy} onClick={()=>setRevision(v=>v+1)}>刷新</button></header>
 <div className="activity-log-controls"><button onClick={()=>step(-1)}>前一天</button><input type="date" aria-label="记录日期" value={day} onChange={e=>choose(e.target.value)}/><button onClick={()=>step(1)}>后一天</button><button onClick={()=>{followToday.current=true;setDay(localDay());setRevision(v=>v+1);}}>今天</button><select aria-label="已有记录日期" value={days.some(v=>v.day===day)?day:''} onChange={e=>choose(e.target.value)}><option value="">选择已有记录</option>{days.map(v=><option key={v.day} value={v.day}>{v.day}{v.incomplete?' · 含未完整时段':''}</option>)}</select></div>
 {error&&<p className="activity-log-error" role="alert">{error}{view?'；下方保留上一次成功读取的记录。':''}</p>}
 {view&&<><div className="activity-log-summary"><span>工作 <b>{duration(view.summary.workingMs)}</b></span><span>休息 <b>{duration(view.summary.restingMs+view.summary.systemRestMs)}</b></span><span>其中系统休息 <b>{duration(view.summary.systemRestMs)}</b></span><span>会议暂停 <b>{duration(view.summary.pausedMs)}</b></span></div><RowLimitedTable className="activity-log-table" label="每日工作休息时段，超过二十条可滚动"><table><thead><tr><th>开始</th><th>结束</th><th>状态</th><th>原因</th><th>时长</th><th>确认状态</th></tr></thead><tbody>{view.segments.map(row)}</tbody></table></RowLimitedTable>{!view.segments.length&&<p className="muted">这一天暂无已确认时段。</p>}</>}
 {!view&&!error&&<p role="status">{busy?'正在读取记录…':'暂无记录。'}</p>}
 <p className="activity-log-caption">短暂触碰不结束休息，持续键鼠操作满 5 秒才恢复工作。午夜按本机日期分段。程序关闭及无法确认的间隔不补算；异常退出只保留最后确认的时间，并标记未完整时段。</p></section>;
}
