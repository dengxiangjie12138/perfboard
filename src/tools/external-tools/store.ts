import type { ExternalTool, ExternalToolInput } from '../../services/api';
export interface ExternalToolsClient {
  list(): Promise<ExternalTool[]>;
  save(tool: ExternalToolInput): Promise<void>;
  remove(id: string): Promise<void>;
  launch(id: string): Promise<void>;
}
export interface ExternalToolsSnapshot { tools: ExternalTool[]; loading: boolean; error: string }
export function selectedExternalTool(tools: ExternalTool[], id?: string) { return id ? tools.find(tool => tool.id === id) : undefined; }
export class ExternalToolsStore {
  private snapshot: ExternalToolsSnapshot = { tools: [], loading: true, error: '' };
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private scope: string | null | undefined;
  private generation = 0;
  constructor(private client: ExternalToolsClient) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<ExternalToolsSnapshot>) { this.snapshot = { ...this.snapshot, ...value }; this.listeners.forEach(listener => listener()); }
  /** Clear the previous warehouse immediately; stale asynchronous responses cannot repopulate it. */
  setRepository = (scope: string | null) => {
    if (scope === this.scope) return;
    this.scope = scope; this.generation += 1;
    this.update({ tools: [], loading: scope !== null, error: '' });
  };
  private enqueue(work: (generation: number) => Promise<void>) {
    const generation = this.generation;
    const operation = this.queue.then(async () => {
      if (generation !== this.generation) throw new Error('仓库已切换，请在当前仓库重试。');
      if (this.scope === null) throw new Error('请先打开数据仓库，再管理外部工具。');
      this.update({ loading: true, error: '' });
      try { await work(generation); }
      catch (error) { if (generation === this.generation) this.update({ error: error instanceof Error ? error.message : String(error) }); throw error; }
      finally { if (generation === this.generation) this.update({ loading: false }); }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  private reload = async (generation: number) => { const tools = await this.client.list(); if (generation === this.generation) this.update({ tools }); };
  refresh = () => this.enqueue(this.reload);
  save = (tool: ExternalToolInput) => this.enqueue(async generation => { await this.client.save(tool); if (generation === this.generation) await this.reload(generation); });
  remove = (id: string) => this.enqueue(async generation => { await this.client.remove(id); if (generation === this.generation) await this.reload(generation); });
  launch = (id: string) => this.enqueue(async generation => {
    try { await this.client.launch(id); }
    catch (error) { if (generation === this.generation) { try { await this.reload(generation); } catch { /* Preserve the explicit launch failure. */ } } throw error; }
  });
}
