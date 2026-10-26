import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createExampleDesign } from './model';
import { AUTO_CORE_IMAGE_PREFIX, createFrozenCoreDocument } from './coreImages';
const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4zwAE/wEHAAH/4iOeWQAAAABJRU5ErkJggg=='), character => character.charCodeAt(0));
let hash = '';
const digest = async (input: Uint8Array) => {
  const value = await globalThis.crypto.subtle.digest('SHA-256', input.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(value)).map(byte => byte.toString(16).padStart(2, '0')).join('');
};
beforeAll(async () => { hash = await digest(bytes); });
function fixture() {
  const document = createExampleDesign();
  document.images = [
    { id: 'manual-pin-diagram', title: '用户引脚图', attachmentId: null, url: null, notes: '保留' },
    { id: AUTO_CORE_IMAGE_PREFIX + 'old', title: '旧系列图', attachmentId: null, url: null, notes: null },
  ];
  const snapshot = JSON.parse(JSON.stringify(document.coreSnapshot!));
  snapshot.images = [{ id: 'series-pq', assetPath: '/core-library/series-pq-fixture.png', sha256: hash,
    binding: 'sheet-series', sourceLabel: 'PQ 型', filename: '高频变压器磁芯手册.xls', sheet: 'PQ', anchor: 'C15:J27', model: 'PQ20/20' }];
  return { document, snapshot };
}
describe('verified frozen core image snapshots', () => {
  it('preserves user images and embeds verified source pixels with an explicit series scope', async () => {
    const { document, snapshot } = fixture();
    const fetchAsset = vi.fn(async () => bytes);
    const frozen = await createFrozenCoreDocument(document, snapshot, { fetchAsset, sha256: digest });
    expect(fetchAsset).toHaveBeenCalledWith('/core-library/series-pq-fixture.png');
    expect(frozen.images[0]).toEqual(document.images[0]);
    expect(frozen.images).toHaveLength(2);
    expect(frozen.images[1].id.startsWith(AUTO_CORE_IMAGE_PREFIX)).toBe(true);
    expect(frozen.images[1].id.length).toBeLessThanOrEqual(128);
    expect(frozen.images[1].notes).toContain('系列参考');
    expect(frozen.images[1].notes).toContain('不是实物照片');
    expect(frozen.images[1].notes).toContain('高频变压器磁芯手册.xls');
    const persisted = JSON.parse(JSON.stringify(frozen));
    expect(Uint8Array.from(atob(persisted.images[1].url.split(',')[1]), character => character.charCodeAt(0))).toEqual(bytes);
    expect(frozen.coreSnapshot?.images).toEqual(snapshot.images);
    snapshot.images[0].sha256 = 'changed';
    expect(frozen.coreSnapshot?.images).not.toEqual(snapshot.images);
    expect(document.images[1].id).toBe(AUTO_CORE_IMAGE_PREFIX + 'old');
  });
  it('rejects a changed library asset without mutating the existing drawing', async () => {
    const { document, snapshot } = fixture();
    snapshot.images[0].sha256 = '0'.repeat(64);
    const original = JSON.stringify(document);
    await expect(createFrozenCoreDocument(document, snapshot, { fetchAsset: async () => bytes, sha256: digest })).rejects.toThrow('SHA256');
    expect(JSON.stringify(document)).toBe(original);
  });
  it('refuses remote or traversing paths before any network access', async () => {
    const { document, snapshot } = fixture();
    const fetchAsset = vi.fn(async () => bytes);
    for (const assetPath of ['https://example.test/core.png', '/core-library/../secrets.png']) {
      snapshot.images[0].assetPath = assetPath;
      await expect(createFrozenCoreDocument(document, snapshot, { fetchAsset, sha256: digest })).rejects.toThrow('可信本地');
    }
    expect(fetchAsset).not.toHaveBeenCalled();
  });
});
