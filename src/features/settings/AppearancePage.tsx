import {useEffect, useState} from 'react';
import {Check, Monitor, Power, RefreshCw} from 'lucide-react';
import {api, errorMessage, native} from '../../services/api';
import {useData} from '../../state/DataContext';
import type {ThemePreference} from '../../types';
import {Heading} from '../../components/Common';
import {settingsApi, type LoginStartupStatus} from './settingsApi';
import './settings.css';

export const themes: {id: ThemePreference; name: string; description: string}[] = [
  {id: 'system', name: '跟随系统', description: '随 Windows 外观自动切换浅色与深色，无需重启。'},
  {id: 'light', name: '浅色', description: '柔和的浅灰背景，深色文字和绿色点缀。'},
  {id: 'dark', name: '深色', description: '偏绿的深色表面，浅绿点缀。'},
  {id: 'codex', name: 'Codex 深色', description: '中性灰黑背景，细线边框和灰白点缀。'},
];
export function LoginStartupControl({status, loading, busy, error, onChange, onRetry}: {
  status: LoginStartupStatus | null; loading: boolean; busy: boolean; error: string | null;
  onChange: (enabled: boolean) => void; onRetry: () => void;
}) {
  return <section className="card section">
    <div className="card-title"><h2><Power size={19}/> 登录启动</h2>
      <span className="muted" role="status">{loading ? '正在读取…' : status?.supported ? (status.enabled ? '已开启' : '已关闭') : '不可用'}</span></div>
    <label className="setting-toggle"><input data-testid="login-startup" type="checkbox" checked={status?.enabled === true}
      disabled={!native || loading || busy || !status?.supported} onChange={event => onChange(event.currentTarget.checked)}/>
      <span>登录 Windows 时启动 Perfboard</span></label>
    <p className="help">默认关闭。开启后，登录时仅在系统托盘运行；点击托盘图标打开主窗口。</p>
    {error && <div className="settings-inline-error"><p className="error-text" role="alert">{error}</p>
      <button className="small" disabled={loading || busy || !native} onClick={onRetry}><RefreshCw size={14}/> 重新读取</button></div>}
    {!native && <p className="help">请在 Perfboard Windows 应用中设置。</p>}
  </section>;
}

export function AppearancePage({theme, onTheme}: {theme: ThemePreference; onTheme: (theme: ThemePreference) => void}) {
  const {repo, data, refresh, notify, setError} = useData();
  const [busy, setBusy] = useState(false);
  const [startup, setStartup] = useState<LoginStartupStatus | null>(null);
  const [startupLoading, setStartupLoading] = useState(native);
  const [startupBusy, setStartupBusy] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);

  useEffect(() => {
    if (!native) return;
    let disposed = false;
    void settingsApi.loginStartupStatus().then(status => {if (!disposed) {setStartup(status); setStartupError(null)}})
      .catch(error => {if (!disposed) setStartupError(errorMessage(error))})
      .finally(() => {if (!disposed) setStartupLoading(false)});
    return () => {disposed = true};
  }, []);
  async function readStartup() {
    setStartupLoading(true);
    try {setStartup(await settingsApi.loginStartupStatus()); setStartupError(null)}
    catch (error) {setStartup(null); setStartupError(errorMessage(error))}
    finally {setStartupLoading(false)}
  }
  async function changeStartup(enabled: boolean) {
    setStartupBusy(true); setStartupError(null);
    try {
      const saved = await settingsApi.setLoginStartup(enabled);
      setStartup(saved); notify(saved.enabled ? '登录启动已开启' : '登录启动已关闭');
    } catch (error) {
      setStartupError(errorMessage(error));
      try {setStartup(await settingsApi.loginStartupStatus())} catch {setStartup(null)}
    } finally {setStartupBusy(false)}
  }
  async function change(id: ThemePreference) {
    setBusy(true);
    try {
      if (repo.ready) {await api.setting('theme', id); await refresh()}
      onTheme(id); notify(repo.ready ? '外观已保存' : '外观已保存到本机');
    } catch (error) {setError(errorMessage(error))} finally {setBusy(false)}
  }
  async function closeAction(value: string) {
    setBusy(true);
    try {await api.setting('closeAction', value); await refresh(); notify('关闭行为已保存')}
    catch (error) {setError(errorMessage(error))} finally {setBusy(false)}
  }
  return <><Heading eyebrow="SOFTWARE SETTINGS" title="软件设置" description="设置主题、窗口关闭行为和登录启动。"/>
    <section className="card"><div className="card-title"><h2><Monitor size={19}/> 界面外观</h2><span className="muted">跟随系统或手动选择</span></div>
      <div className="theme-grid theme-grid-with-system">{themes.map(option => <button data-theme-choice={option.id} key={option.id}
        className={'theme-option ' + (theme === option.id ? 'selected' : '')} aria-pressed={theme === option.id}
        disabled={busy} onClick={() => void change(option.id)}>
        <div className={'theme-swatch ' + option.id}><div/><section><i/><div><b/><b/></div><span/></section></div>
        <div className="theme-label"><strong>{option.name}</strong>{theme === option.id && <Check size={17}/>}</div>
        <p>{option.description}</p></button>)}</div></section>
    <section className="card section"><div className="card-title"><h2>关闭窗口</h2></div>
      <label className="field"><span>点击窗口关闭按钮时</span><select disabled={!repo.ready || busy}
        value={data.settings.closeAction === 'quit' ? 'quit' : 'hide'} onChange={event => void closeAction(event.target.value)}>
        <option value="hide">隐藏到系统托盘</option><option value="quit">退出应用</option></select></label>
      <p className="help">关闭或退出前会保存正在编辑的内容。保存失败时保留当前窗口。</p></section>
    <LoginStartupControl status={startup} loading={startupLoading} busy={startupBusy} error={startupError}
      onChange={enabled => void changeStartup(enabled)} onRetry={() => void readStartup()}/></>;
}
