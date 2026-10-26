import { describe, expect, it, vi } from 'vitest';
import { createExampleDesign } from './model';
import { TransformerSaveSession } from './saveSession';
import { exportTransformerDesignJson } from './json';
import type { SaveDesignInput, TransformerDesignRecord } from './types';

describe('actual native save/export boundary', () => {
  it('passes a bare document JSON with exact null, numeric and image snapshot values to native onSave', async () => {
    const draft = createExampleDesign();
    draft.tests[0].target = 0;
    draft.images.push({ id: 'frozen-image', title: '原图', attachmentId: null, url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4zwAE/wEHAAH/4iOeWQAAAABJRU5ErkJggg==', notes: '原像素快照' });
    const onSave = vi.fn(async (bytes: Uint8Array, name: string) => {
      expect(name).toBe('EXAMPLE-36W_Rev-A.json');
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      expect(parsed).toEqual(draft);
      expect(parsed.document).toBeUndefined();
      expect(parsed.tests[0].target).toBe(0);
      expect(parsed.bobbinSnapshot.view).toBeNull();
      expect(parsed.images[0].url).toBe(draft.images[0].url);
      return true;
    });
    expect(await exportTransformerDesignJson(draft, { onSave })).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
  it('does not report a cancelled native dialog as a successful export', async () => {
    expect(await exportTransformerDesignJson(createExampleDesign(), { onSave: async () => false })).toBe(false);
  });
  it('locks synchronously and snapshots input before a controlled delayed native save', async () => {
    const session = new TransformerSaveSession();
    const draft = createExampleDesign();
    let resolve!: (value: TransformerDesignRecord) => void;
    let savedInput: SaveDesignInput | undefined;
    const save = vi.fn((input: SaveDesignInput) => {
      savedInput = input;
      return new Promise<TransformerDesignRecord>(done => { resolve = done; });
    });
    const pending = session.save({ save }, { id: 'record', expectedRevision: 5, document: draft });
    expect(session.isSaving).toBe(true);
    await expect(session.save({ save }, { id: 'record', expectedRevision: 5, document: draft })).rejects.toThrow('正在进行');
    await Promise.resolve();
    draft.title = '保存请求后的新编辑';
    session.markEdited();
    expect(savedInput!.document.title).not.toBe(draft.title);
    resolve({ id: 'record', revision: 6, createdAt: 'before', updatedAt: 'after', document: savedInput!.document });
    const result = await pending;
    expect(result.record.revision).toBe(6);
    expect(result.unchanged).toBe(false); // Production keeps later draft edits and advances the CAS base.
    expect(result.isCurrentDocument).toBe(true);
    expect(session.isSaving).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('does not install a save response into another document opened during the request', async () => {
    const session = new TransformerSaveSession();
    const document = createExampleDesign();
    let resolve!: (record: TransformerDesignRecord) => void;
    const pending = session.save({ save: () => new Promise(done => { resolve = done; }) }, { id: 'old', expectedRevision: 1, document });
    await Promise.resolve();
    session.beginDocument();
    resolve({ id: 'old', revision: 2, createdAt: '', updatedAt: '', document });
    expect((await pending).isCurrentDocument).toBe(false);
  });
  it('rejects incomplete save data without starting native persistence', async () => {
    const session = new TransformerSaveSession();
    const document = createExampleDesign(); document.designNo = '';
    const save = vi.fn();
    await expect(session.save({ save }, { id: null, expectedRevision: null, document })).rejects.toThrow('设计号');
    expect(save).not.toHaveBeenCalled();
    expect(session.isSaving).toBe(false);
  });
});
