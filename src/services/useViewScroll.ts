import { useEffect } from 'react';
import { currentViewKey, memoryObject, readMemory, viewStorage, writeMemory } from './viewMemory';
import { registerFlush } from './saveRegistry';

export function useViewScroll(feature: string, selector: string, repository?: string | null, ready = true): void {
  const key = currentViewKey('scroll-' + feature, repository);
  useEffect(() => {
    if (!ready) return;
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) return;
    const target = readMemory(viewStorage(), key, { top: 0, left: 0 }, value => memoryObject(value) && typeof value.top === 'number' && Number.isFinite(value.top) && value.top >= 0 && typeof value.left === 'number' && Number.isFinite(value.left) && value.left >= 0 ? { top: value.top, left: value.left } : undefined);
    let restoring = true, last = target, writeFrame = 0;
    const restore = () => {
      if (!restoring) return;
      element.scrollTop = target.top; element.scrollLeft = target.left;
      if (element.scrollHeight - element.clientHeight >= target.top && element.scrollWidth - element.clientWidth >= target.left) { restoring = false; last = { top: element.scrollTop, left: element.scrollLeft }; }
    };
    const startFrame = requestAnimationFrame(restore);
    // Images and asynchronously opened records may increase the content height.
    const observer = new ResizeObserver(restore);
    observer.observe(element); for (const child of element.children) observer.observe(child);
    const save = () => { writeFrame = 0; writeMemory(viewStorage(), key, last); };
    const flush = () => { if (!restoring) writeMemory(viewStorage(), key, last); };
    const unregister = registerFlush(async () => { flush(); });
    window.addEventListener('beforeunload', flush);
    const scroll = () => { if (restoring) return; last = { top: element.scrollTop, left: element.scrollLeft }; if (!writeFrame) writeFrame = requestAnimationFrame(save); };
    const interact = () => { restoring = false; };
    element.addEventListener('scroll', scroll, { passive: true });
    for (const event of ['wheel','touchstart','pointerdown','keydown']) element.addEventListener(event, interact, { passive: true });
    return () => {
      cancelAnimationFrame(startFrame); cancelAnimationFrame(writeFrame); observer.disconnect();
      unregister(); window.removeEventListener('beforeunload', flush);
      element.removeEventListener('scroll', scroll);
      for (const event of ['wheel','touchstart','pointerdown','keydown']) element.removeEventListener(event, interact);
      if (!restoring) writeMemory(viewStorage(), key, last);
    };
  }, [key, selector, ready]);
}
