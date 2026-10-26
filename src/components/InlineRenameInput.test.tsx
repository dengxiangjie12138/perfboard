import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeEvent, CompositionEvent, FocusEvent, InputHTMLAttributes, KeyboardEvent, ReactElement, RefObject } from 'react';
import { InlineRenameInput, type InlineRenameInputProps } from './InlineRenameInput';

// This suite drives the real component handlers without a DOM dependency.
// Native WebView focus and IME ordering still require the Windows acceptance run.
const hooks = vi.hoisted(() => ({
 cursor: 0,
 slots: [] as unknown[],
 effects: [] as (() => void)[],
 cleanups: [] as ((() => void) | undefined)[],
 reset() { this.cursor = 0; this.slots = []; this.effects = []; this.cleanups = []; },
 begin() { this.cursor = 0; },
 finish() { for (const effect of this.effects.splice(0)) effect(); },
 unmount() { for (const cleanup of this.cleanups) cleanup?.(); this.cleanups = []; },
 state<T>(initial: T | (() => T)) {
  const index = this.cursor++;
  if (!(index in this.slots)) this.slots[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
  return [this.slots[index] as T, (next: T | ((previous: T) => T)) => {
   this.slots[index] = typeof next === 'function' ? (next as (previous: T) => T)(this.slots[index] as T) : next;
  }] as const;
 },
 ref<T>(initial: T) {
  const index = this.cursor++;
  if (!(index in this.slots)) this.slots[index] = { current: initial };
  return this.slots[index] as { current: T };
 },
 id() { const index = this.cursor++; return `inline-rename-test-${index}`; },
 effect(effect: () => void | (() => void), dependencies: readonly unknown[]) {
  const index = this.cursor++;
  const previous = this.slots[index] as readonly unknown[] | undefined;
  this.slots[index] = dependencies;
  if (!previous || dependencies.length !== previous.length || dependencies.some((value, i) => !Object.is(value, previous[i]))) {
   this.effects.push(() => {
    this.cleanups[index]?.();
    const cleanup = effect();
    this.cleanups[index] = typeof cleanup === 'function' ? cleanup : undefined;
   });
  }
 },
}));
vi.mock('react', async importOriginal => {
 const actual = await importOriginal<typeof import('react')>();
 return { ...actual, useState: hooks.state.bind(hooks), useRef: hooks.ref.bind(hooks), useId: hooks.id.bind(hooks), useEffect: hooks.effect.bind(hooks) };
});

type InputProps = InputHTMLAttributes<HTMLInputElement> & { ref: RefObject<HTMLInputElement | null> };
type ErrorView = ReactElement<{ id: string; role: string; children: string }>;
function createView(overrides: Partial<InlineRenameInputProps> = {}) {
 const props: InlineRenameInputProps = { initialValue: '原名称', label: '页面名称', onCommit: vi.fn(async () => {}), onCancel: vi.fn(), ...overrides };
 const element = { focus: vi.fn(), select: vi.fn() };
 return {
  props, element,
  render() {
   hooks.begin();
   const view = InlineRenameInput(props);
   const [input, error] = view.props.children as [ReactElement<InputProps>, ErrorView | false | ''];
   input.props.ref.current = element as unknown as HTMLInputElement;
   hooks.finish();
   return { input: input.props, error: error || null };
  },
 };
}
function key(keyValue: string, isComposing = false, keyCode = 0) {
 const nativeEvent = new Event('keydown', { bubbles: true, cancelable: true });
 Object.defineProperties(nativeEvent, { key: { value: keyValue }, isComposing: { value: isComposing }, keyCode: { value: keyCode } });
 return { key: keyValue, nativeEvent, preventDefault: () => nativeEvent.preventDefault(), stopPropagation: () => nativeEvent.stopPropagation() } as unknown as KeyboardEvent<HTMLInputElement>;
}
function change(value: string) { return { currentTarget: { value } } as ChangeEvent<HTMLInputElement>; }
function composition(type: 'compositionstart' | 'compositionend') { return { nativeEvent: new Event(type) } as CompositionEvent<HTMLInputElement>; }
function blur() { return { nativeEvent: new Event('blur') } as FocusEvent<HTMLInputElement>; }
async function settle() { await Promise.resolve(); await Promise.resolve(); }
beforeEach(() => hooks.reset());
afterEach(() => hooks.unmount());

describe('shared inline rename input', () => {
 it('focuses and selects the initial name and exposes the caller label and length limit', () => {
  const view = createView();
  const first = view.render();
  expect(first.input.value).toBe('原名称');
  expect(first.input['aria-label']).toBe('页面名称');
  expect(first.input.maxLength).toBe(200);
  expect(view.element.focus).toHaveBeenCalledOnce();
  expect(view.element.select).toHaveBeenCalledOnce();
  view.props.maxLength = 32;
  expect(view.render().input.maxLength).toBe(32);
  expect(view.element.select).toHaveBeenCalledOnce();
 });
 it('commits one trimmed name on Enter and leaves successful editing teardown to the caller', async () => {
  const view = createView({ initialValue: '  新页面  ' });
  const input = view.render().input;
  const enter = key('Enter');
  input.onKeyDown?.(enter);
  await settle();
  expect(view.props.onCommit).toHaveBeenCalledExactlyOnceWith('新页面');
  expect(enter.nativeEvent.defaultPrevented).toBe(true);
  input.onKeyDown?.(key('Enter'));
  input.onBlur?.(blur());
  expect(view.props.onCommit).toHaveBeenCalledOnce();
  expect(view.props.onCancel).not.toHaveBeenCalled();
 });
 it('keeps whitespace-only names editable and associates the validation error with the input', () => {
  const view = createView({ initialValue: '  \u3000 ' });
  view.render().input.onKeyDown?.(key('Enter'));
  const invalid = view.render();
  expect(view.props.onCommit).not.toHaveBeenCalled();
  expect(view.props.onCancel).not.toHaveBeenCalled();
  expect(invalid.input.disabled).toBe(false);
  expect(invalid.input['aria-invalid']).toBe(true);
  expect(invalid.error?.props.children).toBe('名称不能为空');
  expect(invalid.error?.props.role).toBe('alert');
  expect(invalid.input['aria-describedby']).toBe(invalid.error?.props.id);
 });
 it('rejects composition Enter, native isComposing and post-composition keyCode 229, then commits one real Enter', async () => {
  const view = createView();
  const initial = view.render().input;
  initial.onCompositionStart?.(composition('compositionstart'));
  initial.onChange?.(change('  中文名称  '));
  const input = view.render().input;
  const composingEnter = key('Enter');
  input.onKeyDown?.(composingEnter);
  expect(composingEnter.nativeEvent.defaultPrevented).toBe(false);
  input.onCompositionEnd?.(composition('compositionend'));
  input.onKeyDown?.(key('Enter', true));
  input.onKeyDown?.(key('Enter', false, 229));
  expect(view.props.onCommit).not.toHaveBeenCalled();
  input.onKeyDown?.(key('Enter'));
  await settle();
  expect(view.props.onCommit).toHaveBeenCalledExactlyOnceWith('中文名称');
 });
 it.each(['blur', 'Escape'] as const)('cancels exactly once on %s without writing', action => {
  const view = createView();
  const input = view.render().input;
  if (action === 'blur') input.onBlur?.(blur());
  else input.onKeyDown?.(key('Escape'));
  input.onBlur?.(blur());
  input.onKeyDown?.(key('Escape'));
  input.onKeyDown?.(key('Enter'));
  expect(view.props.onCancel).toHaveBeenCalledOnce();
  expect(view.props.onCommit).not.toHaveBeenCalled();
 });
 it('leaves composition Escape to the IME instead of cancelling the edit', () => {
  const view = createView();
  const input = view.render().input;
  input.onCompositionStart?.(composition('compositionstart'));
  const escape = key('Escape');
  input.onKeyDown?.(escape);
  expect(escape.nativeEvent.defaultPrevented).toBe(false);
  expect(view.props.onCancel).not.toHaveBeenCalled();
  input.onCompositionEnd?.(composition('compositionend'));
  input.onKeyDown?.(key('Escape'));
  expect(view.props.onCancel).toHaveBeenCalledOnce();
 });
 it('prevents duplicate submission and blur cancellation before the disabled state has rendered', async () => {
  let resolve!: () => void;
  const view = createView({ onCommit: vi.fn(() => new Promise<void>(done => { resolve = done; })) });
  const input = view.render().input;
  input.onKeyDown?.(key('Enter'));
  input.onKeyDown?.(key('Enter'));
  input.onBlur?.(blur());
  input.onKeyDown?.(key('Escape'));
  const waiting = view.render();
  expect(waiting.input.disabled).toBe(true);
  waiting.input.onChange?.(change('不应替换待保存名称'));
  expect(view.render().input.value).toBe('原名称');
  expect(view.props.onCommit).toHaveBeenCalledOnce();
  expect(view.props.onCancel).not.toHaveBeenCalled();
  resolve();
  await settle();
  expect(view.props.onCancel).not.toHaveBeenCalled();
 });
 it('retains a failed draft, reports the error and allows a corrected retry', async () => {
  const onCommit = vi.fn().mockRejectedValueOnce(new Error('名称已存在')).mockResolvedValueOnce(undefined);
  const view = createView({ initialValue: '重复名', onCommit });
  view.render().input.onKeyDown?.(key('Enter'));
  await settle();
  const failed = view.render();
  expect(failed.input.disabled).toBe(false);
  expect(failed.input.value).toBe('重复名');
  expect(failed.error?.props.children).toBe('名称已存在');
  failed.input.onChange?.(change('  可用名  '));
  const corrected = view.render();
  expect(corrected.error).toBeNull();
  corrected.input.onKeyDown?.(key('Enter'));
  await settle();
  expect(onCommit.mock.calls).toEqual([['重复名'], ['可用名']]);
  expect(view.props.onCancel).not.toHaveBeenCalled();
 });
});
