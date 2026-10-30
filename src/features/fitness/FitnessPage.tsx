import { useEffect, useRef, useState } from 'react';
import { fitnessDuration, useFitness, type FitnessExercise, type FitnessOutcome } from './fitnessApi';
import './fitness.css';
import '../../components/enable-switch.css';
import {RowLimitedTable} from '../../components/RowLimitedTable';
import {registerFlush} from '../../services/saveRegistry';
import {useSaveShortcut} from '../../services/useSaveShortcut';
import {AttentionSettings} from '../standing-reminder/AttentionSettings';
const outcomes: Record<FitnessOutcome, string> = { complete: '完成', later: '稍后', skip: '跳过' };
export function FitnessPage() {
  const { state, error, desktop, configure, act } = useFitness();
  const [settings, setSettings] = useState({ enabled: false, intervalMs: 600_000, idleMs: 30_000, snoozeMs: 120_000 });
  const [pool, setPool] = useState<FitnessExercise[]>([]), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { if (state && !dirty) { setSettings({ ...state.settings }); setPool(state.pool.map(item => ({ ...item }))); } }, [state, dirty]);
  const latest=useRef({dirty,settings,pool}); latest.current={dirty,settings,pool};
  const saveTask=useRef<Promise<boolean>|null>(null);
  const form=useRef<HTMLFormElement>(null);
  useSaveShortcut(form,async()=>{if(form.current?.reportValidity())await save()},{enabled:desktop&&!!state&&!busy,primary:true});
  async function persist(){
    if(saveTask.current)return saveTask.current;
    const current=latest.current;if(!current.dirty)return true;
    const task=configure({settings:current.settings,pool:current.pool}).then(ok=>{if(ok)setDirty(false);return ok;});
    saveTask.current=task;try{return await task;}finally{saveTask.current=null;}
  }
  const saveRef=useRef(persist);saveRef.current=persist;
  useEffect(()=>registerFlush(async()=>{if(desktop&&latest.current.dirty){if(!await saveRef.current())throw new Error('工作与健身设置保存失败，请检查动作池与设置后重试。');}}),[desktop]);
  if (!state) return <section className="fitness-page"><h2>工作与健身</h2><p role="status">{error || '正在读取后台状态…'}</p></section>;
  const selected = pool.filter(item => item.selected).length;
  const updateExercise = (id: string, patch: Partial<FitnessExercise>) => { setPool(current => current.map(item => item.id === id ? { ...item, ...patch } : item)); setDirty(true); };
  async function save() { if (busy) return; setBusy(true); try { await persist(); } finally { setBusy(false); } }
  async function respond(outcome: FitnessOutcome) { if (!state?.pending || busy) return; setBusy(true); try { await act({ type: 'respond', reminderId: state.pending.id, outcome }); } finally { setBusy(false); } }
  async function startExercise() { if (!state?.pending || busy) return; setBusy(true); try { await act({ type: 'start', reminderId: state.pending.id }); } finally { setBusy(false); } }
  const running = state.settings.enabled && state.sourceAvailable && state.systemMonitorAvailable && !state.blocked && !state.idle;
  const pending = state.pending;
  return <section className="fitness-page" aria-label="工作与健身">
    <header className="page-heading"><div><h2>工作与健身</h2><p>累计键鼠活动，到点从你勾选的动作里随机选一项。</p></div><span className="tag">{!state.settings.enabled ? '已关闭' : running ? '正在累计' : '暂停累计'}</span></header>
    {!desktop && <p className="fitness-info" role="status">浏览器仅预览界面，不采集输入、不计时、不保存设置。</p>}
    {(error || state.error) && <p className="fitness-error" role="alert">{error || state.error}</p>}
    {state.settings.enabled && !state.systemMonitorAvailable && <p className="fitness-warning" role="status">锁屏与睡眠监测不可用，活动累计已暂停。</p>}
    {state.settings.enabled && !state.sourceAvailable && <p className="fitness-warning" role="status">正在等待可靠的键鼠活动来源；来源不可用期间不累计。</p>}
    <div className="fitness-summary">
      <div className="card"><span>本轮活动累计</span><strong>{fitnessDuration(state.activeMs)}</strong><progress aria-label="本轮活动进度" value={Math.min(state.activeMs, state.settings.intervalMs)} max={state.settings.intervalMs} /><small>每累计 {state.settings.intervalMs / 60_000} 分钟提醒一次</small></div>
      <div className="card"><span>距本轮提醒</span><strong>{pending ? pending.snoozeActiveRemainingMs > 0 ? fitnessDuration(pending.snoozeActiveRemainingMs) : '等待处理' : fitnessDuration(state.settings.intervalMs - state.activeMs)}</strong><small>{pending?.snoozeActiveRemainingMs ? '稍后间隔也只累计活动时间' : '离开键鼠后暂停累计'}</small></div>
      <div className="card"><span>今日累计活动</span><strong>{fitnessDuration(state.dailyActiveMs)}</strong><small>键盘和鼠标共用一份时间，不重复相加</small></div>
    </div>
    {pending && <div className="fitness-reminder" role="status"><div><small>{pending.started ? '已开始运动，等待确认完成' : pending.snoozeActiveRemainingMs > 0 ? '已选择稍后' : '本轮随机动作'}</small><h3>{pending.exercise.name}</h3><p>{pending.exercise.instructions || '按照你自己设定的动作要求完成。'}</p></div>
      {pending.snoozeActiveRemainingMs === 0 ? <div className="button-row"><button className="primary" disabled={busy || !desktop} onClick={() => void (pending.started ? respond('complete') : startExercise())}>{pending.started ? '已完成' : '开始运动'}</button><button disabled={busy || !desktop} onClick={() => void respond('later')}>稍后 {state.settings.snoozeMs / 60_000} 分钟</button><button disabled={busy || !desktop} onClick={() => void respond('skip')}>跳过</button><button disabled={busy || !desktop || !running || pending.started} onClick={() => void act({ type: 'show' })}>显示提醒</button></div> : <p className="muted">再累计 {fitnessDuration(pending.snoozeActiveRemainingMs)} 活动时间后提醒，动作保持不变。</p>}</div>}
    <form ref={form} className="card fitness-settings" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="card-title"><h3>活动与提醒设置</h3><label className="fitness-switch enable-switch"><input role="switch" type="checkbox" checked={settings.enabled} disabled={!desktop || busy} onChange={event => { setSettings(current => ({ ...current, enabled: event.target.checked })); setDirty(true); }} />启用工作与健身（保存设置后生效）</label></div>
      <fieldset disabled={!desktop || busy} className="fitness-fields">
        <label>活动累计阈值<span><input aria-label="活动累计阈值（分钟）" type="number" min="1" max="1440" step="1" required value={settings.intervalMs / 60_000} onChange={event => { setSettings(current => ({ ...current, intervalMs: Math.round(Number(event.target.value) * 60_000) })); setDirty(true); }} />分钟</span></label>
        <label>无操作暂停阈值<span><input aria-label="无操作暂停阈值（秒）" type="number" min="1" max="3600" step="1" required value={settings.idleMs / 1000} onChange={event => { setSettings(current => ({ ...current, idleMs: Math.round(Number(event.target.value) * 1000) })); setDirty(true); }} />秒</span></label>
        <label>稍后间隔<span><input aria-label="稍后间隔（分钟）" type="number" min="1" max="60" step="1" required value={settings.snoozeMs / 60_000} onChange={event => { setSettings(current => ({ ...current, snoozeMs: Math.round(Number(event.target.value) * 60_000) })); setDirty(true); }} />活动分钟</span></label>
      </fieldset>
      <p className="fitness-info">最后一次键鼠输入后的 {settings.idleMs / 1000} 秒仍按活动估计，超时暂停；它不代表精确工时。锁屏、睡眠、来源不可用、超过 5 秒的采样间隔与程序关闭期间不会补算。</p>
      <div className="card-title"><h3>随机动作池</h3><span className="muted">已勾选 {selected} 项，每项机会相同</span></div>
      <p className="fitness-info">仅从勾选项随机。俯卧撑、深蹲和马步默认均未勾选，名称与要求可编辑；正在提醒的动作保留原快照。</p>
      <fieldset disabled={!desktop || busy} className="fitness-pool">
        {pool.map(item => <div className="fitness-exercise" key={item.id}><label className="fitness-pool-choice"><input type="checkbox" checked={item.selected} onChange={event => updateExercise(item.id, { selected: event.target.checked })} /><span>加入随机</span></label><label>动作名称<input aria-label={'动作名称 ' + item.name} required maxLength={80} value={item.name} onChange={event => updateExercise(item.id, { name: event.target.value })} /></label><label>个人要求<input aria-label={'动作要求 ' + item.name} maxLength={240} value={item.instructions} placeholder="次数、时长或自己的动作备注（可留空）" onChange={event => updateExercise(item.id, { instructions: event.target.value })} /></label><button type="button" className="small" onClick={() => { setPool(current => current.filter(row => row.id !== item.id)); setDirty(true); }}>删除</button></div>)}
        <button type="button" className="small" disabled={pool.length >= 50} onClick={() => { setPool(current => [...current, { id: crypto.randomUUID(), name: '', instructions: '', selected: false }]); setDirty(true); }}>添加动作</button>
      </fieldset>
      <div className="fitness-settings-actions"><button type="submit" className="primary" title="保存设置 (Ctrl+S)" disabled={!dirty || busy || !desktop}>{busy ? '保存中…' : '保存设置'}</button>{dirty && <button type="button" disabled={busy} onClick={() => setDirty(false)}>撤销未保存设置</button>}<span className="muted">{dirty ? '设置尚未保存' : '设置已保存到本机独立配置'}</span></div>
    </form>
    <AttentionSettings/>
    <div className="fitness-info">久坐与健身共用一个活动提醒窗口，首次显示不夺焦点；未处理时可在原窗口升级为增强提醒。开始运动后保留进行中状态，副屏仅显示必要遮罩。输入来源只保留活动标记和聚合时间，不记录键值、文本或鼠标轨迹。</div>
    <section className="card fitness-history"><div className="card-title"><h3>处理记录</h3><span className="muted">保留最近 200 条</span></div>{!state.history.length ? <p className="muted">暂无处理记录。完成、稍后和跳过会分别记录。</p> : <RowLimitedTable className="table-scroll" label="健身处理记录，超过二十条可滚动"><table><thead><tr><th>时间</th><th>动作</th><th>处理</th><th>本轮活动</th></tr></thead><tbody>{state.history.map(item => <tr key={item.id}><td>{new Date(item.atMs).toLocaleString('zh-CN')}</td><td>{item.exerciseName}</td><td>{outcomes[item.outcome]}</td><td>{fitnessDuration(item.cycleActiveMs)}</td></tr>)}</tbody></table></RowLimitedTable>}</section>
  </section>;
}
export default FitnessPage;
