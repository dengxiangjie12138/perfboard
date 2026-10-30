/** One router per WebView document. A regular save never invokes the leave/quit barrier. */
export interface SaveShortcutOptions {
  enabled?: boolean;
  primary?: boolean;
  onError?: (error: unknown) => void;
}
export interface SaveShortcutState {running: boolean}
type Scope = {element: HTMLElement; save: () => unknown; options: SaveShortcutOptions; state: SaveShortcutState};
type Router = {scopes: Set<Scope>; handle: (event: KeyboardEvent) => void};
const routers = new WeakMap<Document, Router>();
const MODAL = 'dialog[open], [role="dialog"][aria-modal="true"]';

export function isSaveShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing'>): boolean {
  return !event.isComposing && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's';
}
function visible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden]') || !element.getClientRects().length) return false;
  const inert = element.closest<HTMLElement>('[inert]');
  if (!inert) return true;
  // showModal dialogs escape an inert background (including the window's
  // temporary save barrier). An explicitly inert dialog/editor stays blocked.
  const modal = element.closest<HTMLElement>('dialog[open]');
  return !!modal && inert !== modal && inert.contains(modal);
}
function asElement(target: EventTarget | null): Element | null {
  if (!target) return null;
  const element = target as Element;
  return typeof element.closest === 'function' ? element : (target as Node).parentElement ?? null;
}
function innerMost(scopes: Scope[]): Scope | undefined {
  const inner = scopes.filter(scope => !scopes.some(other => other !== scope && scope.element.contains(other.element)));
  return inner.length === 1 ? inner[0] : undefined;
}
function chooseScope(document: Document, scopes: Scope[], target: Element | null): {scope?: Scope; modal: boolean} {
  const active = asElement(document.activeElement);
  const modals = [...document.querySelectorAll<HTMLElement>(MODAL)].filter(visible);
  // Native dialogs trap focus, so the actual focused modal is authoritative.
  // An open dialog with temporarily missing focus still blocks background saves.
  const modal = active?.closest<HTMLElement>(MODAL) ?? target?.closest<HTMLElement>(MODAL) ?? modals.at(-1);
  const eligible = modal ? scopes.filter(scope => modal.contains(scope.element)) : scopes;
  const focused = target && (!modal || modal.contains(target)) ? target : active;
  const containing = focused ? eligible.filter(scope => scope.element.contains(focused)) : [];
  const exact = innerMost(containing);
  if (exact) return {scope: exact, modal: !!modal};
  const primary = eligible.filter(scope => scope.options.primary);
  if (primary.length === 1) return {scope: primary[0], modal: !!modal};
  // A dialog's single editor also owns its heading/close button area.
  if (modal && eligible.length === 1) return {scope: eligible[0], modal: true};
  return {modal: !!modal};
}

export function registerSaveShortcut(element: HTMLElement, save: () => unknown, options: SaveShortcutOptions = {}, state: SaveShortcutState = {running: false}): () => void {
  const document = element.ownerDocument;
  let router = routers.get(document);
  if (!router) {
    const scopes = new Set<Scope>();
    const handle = (event: KeyboardEvent) => {
      if (!isSaveShortcut(event)) return;
      const {scope, modal} = chooseScope(document, [...scopes].filter(value => visible(value.element)), asElement(event.target));
      if (!scope && !modal) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!scope || event.repeat || scope.options.enabled === false || scope.state.running) return;
      scope.state.running = true;
      const failure = (error: unknown) => {scope.options.onError?.(error)};
      try {
        const result = scope.save();
        void Promise.resolve(result).catch(failure).finally(() => {scope.state.running = false});
      } catch (error) {
        scope.state.running = false;
        failure(error);
      }
    };
    router = {scopes, handle};
    routers.set(document, router);
    document.addEventListener('keydown', handle, true);
  }
  const scope = {element, save, options, state};
  router.scopes.add(scope);
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    router.scopes.delete(scope);
    if (!router.scopes.size) {
      document.removeEventListener('keydown', router.handle, true);
      routers.delete(document);
    }
  };
}
