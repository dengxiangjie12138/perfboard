import { describe, expect, it, vi, afterEach } from 'vitest';
import { EMPTY_SCENE, sanitizeScene, restoreStoredScene, decodeSvgDataUrl, isSelfContainedSvg, sceneSearchText } from './scene';
describe('offline scene restoration', () => {
  it('restores a complete embedded raster image and refuses remote file URLs', () => {
    const image = { id: 'image1', mimeType: 'image/png', dataURL: 'data:image/png;base64,aGVsbG8=', created: 1 };
    const result = sanitizeScene(JSON.stringify({ type: 'excalidraw', elements: [{ id: 'local', type: 'image', fileId: 'image1' }], appState: { viewBackgroundColor: '#ffffff' }, files: { image1: image, remote: { dataURL: 'https://example.com/image.png' } } }));
    expect(result.scene.files).toEqual({ image1: image });
    expect(result.scene.elements?.[0]).toMatchObject({ fileId: 'image1' });
    expect(result.removed).toBe(1);
  });
  it('filters iframe and embeddable elements before the editor mounts', () => {
    const result = sanitizeScene(JSON.stringify({ elements: [{ id: 'iframe', type: 'iframe' }, { id: 'embed', type: 'embeddable' }, { id: 'text', type: 'text', text: 'local' }], appState: { activeTool: { type: 'embeddable' } }, files: {} }));
    expect(result.scene.elements).toHaveLength(1);
    expect(result.scene.appState?.activeTool?.type).toBe('selection');
    expect(result.removed).toBe(2);
  });
  it('extracts active text for repository search and ignores deleted text', () => {
    const result = sanitizeScene(JSON.stringify({ elements: [{ id: 'A', type: 'text', text: '电路问题', isDeleted: false }, { id: 'B', type: 'text', text: '已删除', isDeleted: true }, { id: 'C', type: 'rectangle' }] }));
    expect(sceneSearchText(result.scene.elements ?? [])).toBe('电路问题');
  });
  it('accepts an empty canvas and rejects malformed scene structures', () => {
    expect(sanitizeScene(EMPTY_SCENE).scene.files).toEqual({});
    expect(() => sanitizeScene('{')).toThrow();
    expect(() => sanitizeScene('{"elements":"invalid"}')).toThrow('画布格式无效');
  });
});
afterEach(() => vi.unstubAllGlobals());
describe('SVG data URL decoding and lossless restoration barrier', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>电路</text></svg>';
  it('decodes percent-encoded SVG with optional UTF-8 charset', () => {
    expect(decodeSvgDataUrl('data:image/svg+xml,' + encodeURIComponent(svg))).toBe(svg);
    expect(decodeSvgDataUrl('data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg))).toBe(svg);
  });
  it('decodes base64 SVG as UTF-8 rather than Latin-1', () => {
    const payload = btoa(String.fromCharCode(...new TextEncoder().encode(svg)));
    expect(decodeSvgDataUrl('data:image/svg+xml;base64,' + payload)).toBe(svg);
    expect(decodeSvgDataUrl('data:image/svg+xml;charset=utf-8;base64,' + payload)).toBe(svg);
  });
  it('rejects invalid encoding, wrong MIME, and unsupported character sets', () => {
    expect(decodeSvgDataUrl('data:image/svg+xml,%zz')).toBeNull();
    expect(decodeSvgDataUrl('data:image/svg+xml;base64,invalid!')).toBeNull();
    expect(decodeSvgDataUrl('data:text/html,' + encodeURIComponent(svg))).toBeNull();
    expect(decodeSvgDataUrl('data:image/svg+xml;charset=iso-8859-1,' + encodeURIComponent(svg))).toBeNull();
  });
  it('fails closed when the real XML DOMParser is unavailable', () => {
    vi.stubGlobal('DOMParser', undefined);
    expect(isSelfContainedSvg('data:image/svg+xml,' + encodeURIComponent(svg))).toBe(false);
  });
  it('never offers a stored scene as editable after any filtered content', () => {
    const original = JSON.stringify({ elements: [{ id: 'embed', type: 'embeddable' }], files: {} });
    expect(() => restoreStoredScene(original)).toThrow('阻止编辑和覆盖');
    expect(() => restoreStoredScene(JSON.stringify({ elements: [], files: { remote: { dataURL: 'https://example.com/image.svg' } } }))).toThrow('原始数据库内容未修改');
    expect(restoreStoredScene(EMPTY_SCENE).files).toEqual({});
  });
});
