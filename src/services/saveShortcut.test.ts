import {afterEach, describe, expect, it, vi} from 'vitest';
import {isSaveShortcut, registerSaveShortcut} from './saveShortcut';

// Small DOM fixture keeps routing tests independent of a browser package.
// Native focus/dialog and editor behaviour is additionally checked in WebView.
class ElementFixture {
  isConnected = true;
  hidden = false;
  inert = false;
  shown = true;
  modal = false;
  constructor(readonly ownerDocument: DocumentFixture, readonly parentElement: ElementFixture | null = null) {ownerDocument.elements.push(this)}
  contains(element: ElementFixture | null): boolean {for (let next = element; next; next = next.parentElement) if (next === this) return true; return false}
  closest(selector: string): ElementFixture | null {
    if (selector.includes('dialog') ? this.modal : selector.includes('[hidden]') ? this.hidden : this.inert) return this;
    return this.parentElement?.closest(selector) ?? null;
  }
  getClientRects(): object[] {return this.shown ? [{}] : []}
  native(): HTMLElement {return this as unknown as HTMLElement}
}
class DocumentFixture {
  elements: ElementFixture[] = [];
  activeElement: ElementFixture | null = null;
  listeners = new Set<(event: KeyboardEvent) => void>();
  addEventListener(_name: string, listener: (event: KeyboardEvent) => void) {this.listeners.add(listener)}
  removeEventListener(_name: string, listener: (event: KeyboardEvent) => void) {this.listeners.delete(listener)}
  querySelectorAll() {return this.elements.filter(element => element.modal)}
  press(target: ElementFixture | null, options: Partial<KeyboardEvent> = {}) {
    this.activeElement = target;
    const event = {target, key: 's', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, isComposing: false, repeat: false,
      preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), ...options} as unknown as KeyboardEvent;
    this.listeners.forEach(listener => listener(event));
    return event;
  }
}
const cleanups: (() => void)[] = [];
afterEach(() => {cleanups.splice(0).forEach(dispose => dispose())});
function register(element: ElementFixture, action: () => unknown, options = {}) {
  const dispose = registerSaveShortcut(element.native(), action, options);
  cleanups.push(dispose);
  return dispose;
}
const tick = async () => {await Promise.resolve(); await Promise.resolve(); await Promise.resolve()};

describe('save shortcut focus and dialog ownership', () => {
  it('recognizes only an exact Ctrl/Cmd+S chord, including CapsLock, without hijacking IME or save-as', () => {
    const base = {key:'s',ctrlKey:true,metaKey:false,shiftKey:false,altKey:false,isComposing:false};
    expect(isSaveShortcut(base)).toBe(true);
    expect(isSaveShortcut({...base,key:'S'})).toBe(true);
    expect(isSaveShortcut({...base,ctrlKey:false,metaKey:true})).toBe(true);
    for (const patch of [{ctrlKey:false}, {shiftKey:true}, {altKey:true}, {isComposing:true}, {key:'a'}]) expect(isSaveShortcut({...base,...patch})).toBe(false);
  });
  it('saves the innermost focused editor rather than its enclosing page', () => {
    const document = new DocumentFixture(), page = new ElementFixture(document), settings = new ElementFixture(document,page), input = new ElementFixture(document,settings);
    const outer = vi.fn(), inner = vi.fn();
    register(page,outer,{primary:true}); register(settings,inner);
    const event = document.press(input);
    expect(inner).toHaveBeenCalledOnce(); expect(outer).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  });
  it('a disabled or readonly inner scope consumes the chord without falling through to the page', () => {
    const document = new DocumentFixture(), page = new ElementFixture(document), editor = new ElementFixture(document,page);
    const outer = vi.fn(), inner = vi.fn();
    register(page,outer,{primary:true}); register(editor,inner,{enabled:false});
    const event = document.press(editor);
    expect(event.preventDefault).toHaveBeenCalled(); expect(inner).not.toHaveBeenCalled(); expect(outer).not.toHaveBeenCalled();
  });
  it('uses only one visible primary when focus is in navigation, never a hidden mounted editor', () => {
    const document = new DocumentFixture(), navigation = new ElementFixture(document), page = new ElementFixture(document), hidden = new ElementFixture(document);
    hidden.shown = false;
    const save = vi.fn(), old = vi.fn();
    register(page,save,{primary:true}); register(hidden,old,{primary:true});
    document.press(navigation);
    expect(save).toHaveBeenCalledOnce(); expect(old).not.toHaveBeenCalled();
  });
  it('does not guess between two unrelated primary editors', () => {
    const document = new DocumentFixture(), navigation = new ElementFixture(document);
    const a = vi.fn(), b = vi.fn();
    register(new ElementFixture(document),a,{primary:true}); register(new ElementFixture(document),b,{primary:true});
    document.press(navigation);
    expect(a).not.toHaveBeenCalled(); expect(b).not.toHaveBeenCalled();
  });
  it('an open confirmation dialog without an editor blocks a background save', () => {
    const document = new DocumentFixture(), page = new ElementFixture(document), modal = new ElementFixture(document,page), cancel = new ElementFixture(document,modal);
    modal.modal = true;
    const save = vi.fn(); register(page,save,{primary:true});
    const event = document.press(cancel);
    expect(save).not.toHaveBeenCalled(); expect(event.preventDefault).toHaveBeenCalled();
    // Also protected during a transient missing modal focus.
    document.press(null); expect(save).not.toHaveBeenCalled();
  });
  it('saves the editor in the focused modal even when it is not the final dialog in DOM order', () => {
    const document = new DocumentFixture(), page = new ElementFixture(document), a = new ElementFixture(document,page), b = new ElementFixture(document,page);
    a.modal = true; b.modal = true;
    const formA = new ElementFixture(document,a), formB = new ElementFixture(document,b), closeA = new ElementFixture(document,a);
    const outer = vi.fn(), saveA = vi.fn(), saveB = vi.fn();
    register(page,outer,{primary:true}); register(formA,saveA); register(formB,saveB);
    document.press(closeA);
    expect(saveA).toHaveBeenCalledOnce(); expect(saveB).not.toHaveBeenCalled(); expect(outer).not.toHaveBeenCalled();
  });
  it('scopes each document independently so an independent window cannot save another window', () => {
    const first = new DocumentFixture(), second = new DocumentFixture(), a = new ElementFixture(first), b = new ElementFixture(second);
    const saveA = vi.fn(), saveB = vi.fn(); register(a,saveA); register(b,saveB);
    first.press(a); expect(saveA).toHaveBeenCalledOnce(); expect(saveB).not.toHaveBeenCalled();
    second.press(b); expect(saveB).toHaveBeenCalledOnce();
  });
  it('allows a native save dialog to escape the frozen background while its own inert editor remains blocked', async () => {
    const document = new DocumentFixture(), frozen = new ElementFixture(document), modal = new ElementFixture(document,frozen), form = new ElementFixture(document,modal);
    frozen.inert = true; modal.modal = true;
    const outer = vi.fn(), save = vi.fn(); register(frozen,outer,{primary:true}); register(form,save);
    document.press(form); await tick();
    expect(save).toHaveBeenCalledOnce(); expect(outer).not.toHaveBeenCalled();
    form.inert = true; document.press(form);
    expect(save).toHaveBeenCalledOnce(); expect(outer).not.toHaveBeenCalled();
  });
  it('current inline name edits are committed once without also flushing the parent log', async () => {
    const document = new DocumentFixture(), page = new ElementFixture(document), rename = new ElementFixture(document,page);
    const draft = {value:'原名'}, commit = vi.fn(), flushPage = vi.fn();
    register(page,flushPage,{primary:true}); register(rename,() => commit(draft.value));
    draft.value = '最后刚输入的名称';
    document.press(rename); await tick();
    expect(commit).toHaveBeenCalledWith('最后刚输入的名称'); expect(flushPage).not.toHaveBeenCalled();
  });
});

describe('save shortcut submission lifecycle', () => {
  it('holds one async save through rerenders, consumes repeated keys, and permits a later explicit save', async () => {
    const document = new DocumentFixture(), editor = new ElementFixture(document);
    let resolve!: () => void;
    const action = vi.fn(() => new Promise<void>(done => {resolve=done}));
    const state = {running:false};
    let dispose = registerSaveShortcut(editor.native(),action,{},state);
    document.press(editor);
    dispose(); dispose = registerSaveShortcut(editor.native(),action,{},state); cleanups.push(dispose);
    document.press(editor); const repeated = document.press(editor,{repeat:true});
    expect(action).toHaveBeenCalledOnce(); expect(repeated.preventDefault).toHaveBeenCalled();
    resolve(); await tick();
    document.press(editor); expect(action).toHaveBeenCalledTimes(2);
    resolve(); await tick();
  });
  it('reports failed saves and releases the submission gate for an explicit retry', async () => {
    const document = new DocumentFixture(), editor = new ElementFixture(document), error = new Error('校验失败，草稿保留');
    const onError = vi.fn(), save = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    register(editor,save,{onError});
    document.press(editor); await tick();
    expect(onError).toHaveBeenCalledWith(error);
    document.press(editor); await tick(); expect(save).toHaveBeenCalledTimes(2);
  });
  it('cleans up the single listener after the final scope unmounts', () => {
    const document = new DocumentFixture(), a = new ElementFixture(document), b = new ElementFixture(document);
    const first = register(a,vi.fn()), second = register(b,vi.fn());
    expect(document.listeners.size).toBe(1); first(); expect(document.listeners.size).toBe(1); second(); expect(document.listeners.size).toBe(0);
  });
  it('a repeated stale cleanup cannot remove a newly mounted editor listener', () => {
    const document = new DocumentFixture(), first = new ElementFixture(document), next = new ElementFixture(document);
    const dispose = register(first,vi.fn()); dispose();
    const save = vi.fn(); register(next,save);
    dispose(); document.press(next);
    expect(document.listeners.size).toBe(1); expect(save).toHaveBeenCalledOnce();
  });
});
