import type { SaveDesignInput, TransformerDesignApi, TransformerDesignRecord } from './types';
import { copyDocument, saveValidation } from './model';

export interface SaveSnapshotResult {
  record: TransformerDesignRecord;
  unchanged: boolean;
  isCurrentDocument: boolean;
}
/** A synchronous gate plus generation tracking protects delayed native saves. */
export class TransformerSaveSession {
  private pending: Promise<SaveSnapshotResult> | null = null;
  private generation = 0;
  private documentGeneration = 0;
  get isSaving(): boolean { return this.pending !== null; }
  markEdited(): void { this.generation++; }
  beginDocument(): void { this.documentGeneration++; this.generation++; }
  async save(api: Pick<TransformerDesignApi, 'save'>, input: SaveDesignInput): Promise<SaveSnapshotResult> {
    if (this.pending) throw new Error('设计保存正在进行，请等待完成。');
    const errors = saveValidation(input.document);
    if (errors.length) throw new Error(errors.join(' '));
    const generation = this.generation;
    const documentGeneration = this.documentGeneration;
    const snapshot = { ...input, document: copyDocument(input.document) };
    const operation = Promise.resolve().then(() => api.save(snapshot)).then(record => ({
      record,
      unchanged: generation === this.generation && documentGeneration === this.documentGeneration,
      isCurrentDocument: documentGeneration === this.documentGeneration,
    }));
    this.pending = operation;
    try { return await operation; }
    finally { if (this.pending === operation) this.pending = null; }
  }
}
