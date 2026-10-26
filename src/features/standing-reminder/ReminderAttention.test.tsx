import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { initialFitnessSnapshot } from '../fitness/fitnessApi';
import { AttentionSettings } from './AttentionSettings';
import { initialAttentionSnapshot, type AttentionSnapshot } from './attentionApi';
import { AttentionPanel } from './ReminderAttention';
import type { ReminderSnapshot } from './reminderApi';

function standing(): ReminderSnapshot {
  return {
    settings: { enabled: true, workSeconds: 2700, restSeconds: 180, idleSeconds: 60, sound: true, autoLock: false },
    activeDurations: { workSeconds: 2700, restSeconds: 180, idleSeconds: 60 }, pendingDurations: false,
    mode: 'working', workMs: 2700000, workRemainingMs: 0, restMs: 0, restRemainingMs: 180000,
    idleConfirmationRemainingMs: 60000, due: true, roundId: 1, promptToken: 1,
    promptVisible: true, promptPresented: true, reminderCount: 1, snoozeUsed: false,
    snoozeRemainingMs: null, lockRemainingMs: null, lockAttempted: false,
    inputSourceStatus: 'test', resumeConfirmationRemainingMs: null, error: null,
    testMode: true, systemMonitorAvailable: true, simulatedLockRequests: 0,
  };
}
function combined(): AttentionSnapshot {
  const fitness = initialFitnessSnapshot();
  fitness.settings.enabled = true;
  fitness.promptVisible = true;
  fitness.pending = { id: 17, exercise: { id: 'squats', name: '深蹲', instructions: '按自己的要求完成', selected: true }, issuedAtMs: 1, snoozeActiveRemainingMs: 0, started: false };
  return { ...initialAttentionSnapshot(), active: true, escalated: true, standing: standing(), fitness };
}
type ButtonProps = { children?: ReactNode; disabled?: boolean; onClick: () => void };
function button(tree: ReactNode, label: string): ButtonProps {
  const found: ButtonProps[] = [];
  const walk = (node: ReactNode) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!isValidElement<{ children?: ReactNode }>(node)) return;
    if (node.type === 'button' && renderToStaticMarkup(node).includes(label)) found.push(node.props as ButtonProps);
    walk(node.props.children);
  };
  walk(tree);
  if (found.length !== 1) throw new Error(`Expected one ${label} button, got ${found.length}`);
  return found[0];
}
describe('shared reminder attention UI', () => {
  it('uses the five-minute shared default and allows disabling the escalation', () => {
    expect(initialAttentionSnapshot().settings).toEqual({ enabled: true, delaySeconds: 300 });
    const html = renderToStaticMarkup(<AttentionSettings />);
    expect(html).toContain('久坐和健身共用此设置与一个活动提醒窗口');
    expect(html).toContain('启用增强提醒');
    expect(html).toContain('min="1" max="60"');
    expect(html).toContain('value="5"');
  });
  it('shows both due reminders in one panel with a permanent escape action', () => {
    const html = renderToStaticMarkup(<AttentionPanel state={combined()} error="" busy={false} onAction={vi.fn()} />);
    expect(html.match(/class="attention-panel"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="久坐休息"');
    expect(html).toContain('aria-label="健身活动"');
    expect(html).toContain('45:00');
    expect(html).toContain('开始休息');
    expect(html).toContain('开始运动');
    expect(html).toContain('关闭遮罩 · 稍后全部');
    expect(html).toContain('Esc');
  });
  it('uses one compact activity panel before escalation with both reminders', () => {
    const state = { ...combined(), escalated: false };
    const html = renderToStaticMarkup(<AttentionPanel state={state} error="" busy={false} onAction={vi.fn()} />);
    expect(html).toContain('attention-compact');
    expect(html).toContain('aria-modal="false"');
    expect(html.match(/class="attention-panel"/g)).toHaveLength(1);
    expect(html).toContain('开始休息');
    expect(html).toContain('开始运动');
    expect(html).toContain('关闭提醒');
  });
  it('secondary displays have an escape route without duplicating activity cards', () => {
    const onAction = vi.fn();
    const tree = AttentionPanel({ state: combined(), error: '', busy: true, backdrop: true, onAction });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('reminder-attention-backdrop');
    expect(html).not.toContain('attention-panel');
    expect(html).not.toContain('开始运动');
    expect(html).not.toContain('开始休息');
    const close = button(tree, '关闭遮罩');
    expect(close.disabled).not.toBe(true);
    close.onClick();
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'laterAll' });
  });
  it('starting exercise sends start with the original reminder ID, never completion', () => {
    const onAction = vi.fn();
    const tree = AttentionPanel({ state: combined(), error: '', busy: false, onAction });
    button(tree, '开始运动').onClick();
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'fitness', action: 'start', reminderId: 17 });
  });
  it('offers completion only after the exercise has started', () => {
    const state = combined();
    state.fitness!.pending!.started = true;
    const onAction = vi.fn();
    const tree = AttentionPanel({ state, error: '', busy: false, onAction });
    expect(() => button(tree, '开始运动')).toThrow('got 0');
    expect(renderToStaticMarkup(tree)).toContain('运动进行中');
    expect(renderToStaticMarkup(tree)).toContain('进行中 · 等待确认完成');
    expect(renderToStaticMarkup(tree)).toContain('attention-overlay');
    button(tree, '已完成').onClick();
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'fitness', action: 'complete', reminderId: 17 });
  });
  it('keeps close enabled while loading, when saving fails, and during another action', () => {
    for (const state of [null, combined()]) {
      const onAction = vi.fn();
      const tree = AttentionPanel({ state, error: '保存失败', busy: true, onAction });
      const close = button(tree, '稍后全部');
      expect(close.disabled).not.toBe(true);
      close.onClick();
      expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'laterAll' });
      expect(renderToStaticMarkup(tree)).toContain('保存失败');
    }
  });
  it('routes rest and later independently without clearing the other reminder', () => {
    const onAction = vi.fn();
    const tree = AttentionPanel({ state: combined(), error: '', busy: false, onAction });
    button(tree, '开始休息').onClick();
    expect(onAction).toHaveBeenLastCalledWith({ type: 'standing', action: 'startRest' });
    button(tree, '稍后 2 分钟').onClick();
    expect(onAction).toHaveBeenLastCalledWith({ type: 'fitness', action: 'later', reminderId: 17 });
  });
  it('shows an acknowledged state without stale cards when no reminders remain', () => {
    const html = renderToStaticMarkup(<AttentionPanel state={initialAttentionSnapshot()} error="" busy={false} onAction={vi.fn()} />);
    expect(html).toContain('提醒已处理');
    expect(html).not.toContain('class="attention-card"');
    expect(html).toContain('关闭提醒');
  });
  it('does not permit repeated card actions while an operation is pending', () => {
    const tree = AttentionPanel({ state: combined(), error: '', busy: true, onAction: vi.fn() });
    expect(button(tree, '开始休息').disabled).toBe(true);
    expect(button(tree, '开始运动').disabled).toBe(true);
  });
  it('retains a visible countdown and cancellation while a different action is pending', () => {
    const state = combined();
    state.standing!.lockRemainingMs = 12000;
    const onAction = vi.fn();
    const tree = AttentionPanel({ state, error: '', busy: true, onAction });
    expect(renderToStaticMarkup(tree)).toContain('00:12');
    const cancel = button(tree, '取消本轮锁屏');
    expect(cancel.disabled).not.toBe(true);
    cancel.onClick();
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'standing', action: 'cancelLock' });
  });
  it('shows distinct backend persistence failures even alongside an action error', () => {
    const state = combined();
    state.error = '提醒配置未保存';
    state.standing!.error = '休息记录未保存';
    state.fitness!.error = '运动记录未保存';
    const html = renderToStaticMarkup(<AttentionPanel state={state} error="操作未保存" busy={false} onAction={vi.fn()} />);
    for (const text of ['提醒配置未保存', '休息记录未保存', '运动记录未保存', '操作未保存']) expect(html).toContain(text);
  });
});
