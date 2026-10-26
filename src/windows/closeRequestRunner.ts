import {isSaveCancelled} from '../services/saveRegistry';
import type { CloseRequest } from './contracts';
export interface CloseRequestCallbacks { flush: (context?: CloseRequest['action']) => Promise<void>; respond: (request: CloseRequest, saved: boolean) => Promise<void>; saveFailed: (error: unknown) => void; responseFailed: (error: unknown) => void; started?: (request: CloseRequest) => void; finished?: (request: CloseRequest, saved: boolean, responded: boolean) => void }
/** A webview responds once per request; disposed or superseded work cannot acknowledge. */
export class CloseRequestRunner {
  private latest = 0;
  private disposed = false;
  private seen = new Set<number>();
  constructor(private readonly callbacks: CloseRequestCallbacks) {}
  dispose(): void { this.disposed = true; }
  async run(request: CloseRequest): Promise<void> {
    if (this.disposed || !Number.isSafeInteger(request.requestId) || request.requestId < 1 || !['hide', 'quit', 'close-tool', 'flush'].includes(request.action) || this.seen.has(request.requestId) || request.requestId < this.latest) return;
    this.latest = request.requestId; this.seen.add(request.requestId); this.callbacks.started?.(request);
    if (this.seen.size > 64) this.seen.delete(this.seen.values().next().value!);
    let saved = true;
    try { await this.callbacks.flush(request.action); }
    catch (error) { saved = false; if (!isSaveCancelled(error) && !this.disposed && this.latest === request.requestId) this.callbacks.saveFailed(error); }
    if (this.disposed || this.latest !== request.requestId) return;
    let responded = false;
    try { await this.callbacks.respond(request, saved); responded = true; }
    catch (error) { if (!this.disposed && this.latest === request.requestId) this.callbacks.responseFailed(error); }
    if (!this.disposed && this.latest === request.requestId) this.callbacks.finished?.(request, saved, responded);
  }
}
