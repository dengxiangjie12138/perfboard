import {beforeEach, expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {ChangeEvent, InputHTMLAttributes, ReactElement} from 'react';
import {AppearancePage, LoginStartupControl, themes} from './AppearancePage';
import {settingsApi} from './settingsApi';

const state = vi.hoisted(() => ({
  repo: {ready: true, configured: true, path: 'D:\\isolated', error: null},
  data: {settings: {closeAction: 'hide'}}, refresh: vi.fn(), notify: vi.fn(), setError: vi.fn(),
}));
vi.mock('../../state/DataContext', () => ({useData: () => state}));
vi.mock('../../services/api', () => ({native: true, api: {setting: vi.fn()}, errorMessage: (error: unknown) => String(error)}));
vi.mock('./settingsApi', () => ({settingsApi: {loginStartupStatus: vi.fn(), setLoginStartup: vi.fn()}}));
beforeEach(() => vi.clearAllMocks());

it('retains all three manual themes alongside system appearance and close behavior', () => {
  const html = renderToStaticMarkup(<AppearancePage theme="codex" onTheme={() => {}}/>);
  expect(html).toContain('<h1>软件设置</h1>');
  for (const theme of themes) expect(html).toContain('data-theme-choice="' + theme.id + '"');
  expect(html).toContain('隐藏到系统托盘');
  expect(html).toContain('退出应用');
  expect(html).toContain('保存失败时保留当前窗口');
  expect(settingsApi.loginStartupStatus).not.toHaveBeenCalled();
  expect(settingsApi.setLoginStartup).not.toHaveBeenCalled();
});
it('marks the saved system preference as selected independently of its resolved color', () => {
  const html = renderToStaticMarkup(<AppearancePage theme="system" onTheme={() => {}}/>);
  expect(html).toContain('data-theme-choice="system" class="theme-option selected" aria-pressed="true"');
  expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  expect(html).toContain('随 Windows 外观自动切换浅色与深色，无需重启。');
});
it('does not present loading or failed registration reads as enabled', () => {
  for (const props of [
    {status: null, loading: true, error: null},
    {status: null, loading: false, error: 'Injected read failure'},
    {status: {supported: false, enabled: false}, loading: false, error: null},
  ]) {
    const html = renderToStaticMarkup(<LoginStartupControl {...props} busy={false} onChange={() => {}} onRetry={() => {}}/>);
    expect(html).toContain('type="checkbox" disabled=""');
    expect(html).not.toContain('checked=""');
  }
});
it('renders the actual OS status and blocks changes while a save is running', () => {
  const html = renderToStaticMarkup(<LoginStartupControl status={{supported: true, enabled: true}} loading={false}
    busy={true} error={null} onChange={() => {}} onRetry={() => {}}/>);
  expect(html).toContain('已开启');
  expect(html).toContain('disabled="" checked=""');
  expect(html).toContain('仅在系统托盘运行');
});
it('an explicit checkbox action passes its requested state to the save handler', () => {
  const onChange = vi.fn();
  const view = LoginStartupControl({status: {supported: true, enabled: false}, loading: false, busy: false,
    error: null, onChange, onRetry: () => {}});
  const label = view.props.children[1] as ReactElement<{children: ReactElement[]}>;
  const input = label.props.children[0] as ReactElement<InputHTMLAttributes<HTMLInputElement>>;
  expect(onChange).not.toHaveBeenCalled();
  input.props.onChange?.({currentTarget: {checked: true}} as ChangeEvent<HTMLInputElement>);
  expect(onChange.mock.calls).toEqual([[true]]);
});
