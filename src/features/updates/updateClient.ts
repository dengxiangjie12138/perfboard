import {initialUpdateStatus, type UpdateStatus} from './updateApi';

export type UpdateAction = 'check' | 'set-auto' | 'download' | 'install' | 'open';
export interface UpdateSnapshot {
  status: UpdateStatus;
  supported: boolean;
  loading: boolean;
  pendingAction: UpdateAction | null;
}
export interface UpdateTransport {
  status: () => Promise<UpdateStatus>;
  listen: (receive: (status: UpdateStatus) => void) => Promise<() => void>;
}
function failureText(error: unknown): string {return error instanceof Error ? error.message : String(error)}

/** Native owns scheduling. This client keeps one live view while routes and windows change. */
export class UpdateClient {
  private snapshot: UpdateSnapshot;
  private listeners = new Set<() => void>();
  private generation = 0;
  private revision = 0;
  private active = false;
  private unlisten: (() => void) | undefined;
  constructor(private readonly transport: UpdateTransport, supported: boolean) {
    this.snapshot = {status: initialUpdateStatus(), supported, loading: supported, pendingAction: null};
  }
  getSnapshot = (): UpdateSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {this.listeners.delete(listener)};
  };
  private publish(change: Partial<UpdateSnapshot>): void {
    this.snapshot = {...this.snapshot, ...change};
    this.listeners.forEach(listener => listener());
  }
  private adopt(status: UpdateStatus, loading = this.snapshot.loading): void {
    ++this.revision;
    this.publish({status, loading});
  }
  async start(): Promise<void> {
    if (!this.snapshot.supported || this.active) return;
    this.active = true;
    const generation = ++this.generation;
    let revision = this.revision;
    this.publish({loading: true});
    try {
      const unlisten = await this.transport.listen(status => {
        if (!this.active || this.generation !== generation) return;
        this.adopt(status, false);
      });
      if (!this.active || this.generation !== generation) {unlisten(); return}
      this.unlisten = unlisten;
      revision = this.revision;
      const status = await this.transport.status();
      if (this.active && this.generation === generation && this.revision === revision) this.adopt(status);
    } catch (error) {
      if (this.active && this.generation === generation && this.revision === revision) {
        this.adopt({...this.snapshot.status, error: failureText(error)});
      }
    } finally {
      if (this.active && this.generation === generation) this.publish({loading: false});
    }
  }
  stop(): void {
    this.active = false;
    ++this.generation;
    this.unlisten?.();
    this.unlisten = undefined;
    this.publish({pendingAction: null});
  }
  async perform(action: UpdateAction, operation: () => Promise<UpdateStatus | void>): Promise<void> {
    if (!this.active || !this.snapshot.supported || this.snapshot.loading || this.snapshot.pendingAction) return;
    const generation = this.generation, revision = this.revision;
    this.publish({pendingAction: action});
    try {
      const status = await operation();
      if (status && this.active && this.generation === generation && this.revision === revision) this.adopt(status);
    } catch (error) {
      if (this.active && this.generation === generation) {
        this.adopt({...this.snapshot.status, error: failureText(error)});
      }
    } finally {
      if (this.active && this.generation === generation) this.publish({pendingAction: null});
    }
  }
}
