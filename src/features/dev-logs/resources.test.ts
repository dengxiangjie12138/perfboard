import { describe, expect, it, vi } from 'vitest';
import { getSchema } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Fragment, Slice } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { parseStoredDocument } from './document';
import { normalizeLogFormatting } from './documentFormatting';
import { LogFileAttachment, LogImage } from './resourceSchema';
import { formatResourceSize, prepareResourcePaste, remapResourceSlice, replaceResourceSelection, resourceNode, sliceResourceIds } from './resourceTransfer';
import { MAX_LOG_RESOURCE_BYTES, logResourceApi, validateLogFile, type LogResourceMetadata } from './resourceApi';
import { ResourceOperationQueue } from './resourceOperations';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const schema = getSchema([StarterKit, LogImage, LogFileAttachment]);
const metadata: LogResourceMetadata = { id: 'resource-a', pageId: 'page-a', name: '示例.png', mime: 'image/png', size: 6, sha256: 'hash', isImage: true };

describe('log resource documents', () => {
 it('retains sequential image and file imports and types in the following paragraph', () => {
  const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create());
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, 1) });
  const image = schema.nodes.image.create({ resourceId: 'inserted-image' });
  const file = schema.nodes.fileAttachment.create({ resourceId: 'inserted-file' });
  for (const resource of [image, file]) {
   state = state.apply(replaceResourceSelection(state.tr, new Slice(Fragment.from(resource), 0, 0)));
   expect(state.selection).toBeInstanceOf(TextSelection);
   expect(state.selection.empty).toBe(true);
   expect(state.selection.$from.parent.type.name).toBe('paragraph');
  }
  state = state.apply(state.tr.insertText('After both resources'));
  expect(() => state.doc.check()).not.toThrow();
  expect(state.doc.toJSON()).toEqual({ type: 'doc', content: [
   image.toJSON(), file.toJSON(),
   { type: 'paragraph', content: [{ type: 'text', text: 'After both resources' }] },
  ] });
 });
 it('creates the typing paragraph before the next existing resource', () => {
  const existing = schema.nodes.fileAttachment.create({ resourceId: 'existing-file' });
  const doc = schema.nodes.doc.create(null, [
   schema.nodes.paragraph.create(), existing,
   schema.nodes.paragraph.create(null, schema.text('Later text')),
  ]);
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, 1) });
  const image = schema.nodes.image.create({ resourceId: 'inserted-image' });
  state = state.apply(replaceResourceSelection(state.tr, new Slice(Fragment.from(image), 0, 0)));
  state = state.apply(state.tr.insertText('Immediately after image'));
  expect(state.doc.toJSON()).toEqual({ type: 'doc', content: [
   image.toJSON(),
   { type: 'paragraph', content: [{ type: 'text', text: 'Immediately after image' }] },
   existing.toJSON(),
   { type: 'paragraph', content: [{ type: 'text', text: 'Later text' }] },
  ] });
 });
 it('drops before an existing image without replacing that image', () => {
  const image = schema.nodes.image.create({ resourceId: 'existing-image' });
  const file = schema.nodes.fileAttachment.create({ resourceId: 'dropped-file' });
  const doc = schema.nodes.doc.create(null, [image, schema.nodes.paragraph.create()]);
  let state = EditorState.create({ doc, selection: NodeSelection.create(doc, 0) });
  state = state.apply(replaceResourceSelection(state.tr, new Slice(Fragment.from(file), 0, 0), 0));
  expect(state.selection).toBeInstanceOf(TextSelection);
  state = state.apply(state.tr.insertText('After dropped file'));
  expect(() => state.doc.check()).not.toThrow();
  expect(state.doc.toJSON()).toEqual({ type: 'doc', content: [
   file.toJSON(),
   { type: 'paragraph', content: [{ type: 'text', text: 'After dropped file' }] },
   image.toJSON(), schema.nodes.paragraph.create().toJSON(),
  ] });
 });
 it('drops at its coordinate without replacing the current text selection', () => {
  const paragraph = schema.nodes.paragraph.create(null, schema.text('Keep selected text'));
  const image = schema.nodes.image.create({ resourceId: 'dropped-image' });
  const doc = schema.nodes.doc.create(null, paragraph);
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, 6, 14) });
  state = state.apply(replaceResourceSelection(state.tr, new Slice(Fragment.from(image), 0, 0), doc.content.size));
  expect(state.selection).toBeInstanceOf(TextSelection);
  state = state.apply(state.tr.insertText('After drop'));
  expect(() => state.doc.check()).not.toThrow();
  expect(state.doc.toJSON()).toEqual({ type: 'doc', content: [
   paragraph.toJSON(), image.toJSON(),
   { type: 'paragraph', content: [{ type: 'text', text: 'After drop' }] },
  ] });
 });
 it('replaces the intended selected resource and reuses its following paragraph', () => {
  const doc = schema.nodes.doc.create(null, [
   schema.nodes.image.create({ resourceId: 'selected-image' }),
   schema.nodes.paragraph.create(null, schema.text('Existing text')),
  ]);
  let state = EditorState.create({ doc, selection: NodeSelection.create(doc, 0) });
  const file = schema.nodes.fileAttachment.create({ resourceId: 'replacement-file' });
  state = state.apply(replaceResourceSelection(state.tr, new Slice(Fragment.from(file), 0, 0)));
  state = state.apply(state.tr.insertText('Before '));
  expect(state.doc.toJSON()).toEqual({ type: 'doc', content: [
   file.toJSON(),
   { type: 'paragraph', content: [{ type: 'text', text: 'Before Existing text' }] },
  ] });
 });
 it('keeps a nested resource slice intact and types after its closed list', () => {
  const paragraph = schema.nodes.paragraph.create(null, schema.text('List caption', [schema.marks.bold.create()]));
  const image = schema.nodes.image.create({ resourceId: 'nested-image' });
  const list = schema.nodes.bulletList.create(null, schema.nodes.listItem.create(null, [paragraph, image]));
  const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create());
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, 1) });
  state = state.apply(replaceResourceSelection(state.tr, new Slice(Fragment.from(list), 0, 0)));
  state = state.apply(state.tr.insertText('After the list'));
  expect(() => state.doc.check()).not.toThrow();
  expect(state.doc.toJSON()).toEqual({ type: 'doc', content: [
   list.toJSON(),
   { type: 'paragraph', content: [{ type: 'text', text: 'After the list' }] },
  ] });
 });
 it('preserves normal selection replacement and caret behavior for open slices ending in rich text', () => {
  const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, schema.text('Before selected after')));
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 8, 16) });
  const slice = new Slice(Fragment.fromArray([
   schema.nodes.paragraph.create(null, schema.text('Caption')),
   schema.nodes.image.create({ resourceId: 'pasted-image' }),
   schema.nodes.paragraph.create(null, schema.text('Formatted', [schema.marks.italic.create()])),
  ]), 1, 1);
  const expected = state.apply(state.tr.replaceSelection(slice));
  const actual = state.apply(replaceResourceSelection(state.tr, slice));
  expect(actual.doc.toJSON()).toEqual(expected.doc.toJSON());
  expect(actual.selection.eq(expected.selection)).toBe(true);
  expect(actual.doc.textContent).toBe('Before CaptionFormatted after');
  expect(actual.doc.lastChild?.firstChild?.marks.map(mark => mark.type.name)).toEqual(['italic']);
 });
 it('round trips image and attachment references without persisting binary data or runtime URLs', () => {
  const json = { type: 'doc', content: [
   { type: 'paragraph', content: [{ type: 'text', text: '实验照片', marks: [{ type: 'bold' }] }] },
   { type: 'image', attrs: { resourceId: 'image-id', src: 'blob:runtime-only', name: 'stale name' } },
   { type: 'fileAttachment', attrs: { resourceId: 'file-id', data: 'base64-private-data' } },
  ] };
  const parsed = parseStoredDocument(JSON.stringify(json), 1);
  expect(parsed).toEqual({ ...json, content: [json.content[0], { type: 'image', attrs: { resourceId: 'image-id' } }, { type: 'fileAttachment', attrs: { resourceId: 'file-id' } }] });
  expect(JSON.stringify(parsed)).not.toMatch(/blob:|base64|stale name/);
  expect(() => parseStoredDocument(JSON.stringify({ type: 'doc', content: [{ type: 'image', attrs: { src: 'https://external/image' } }] }), 1)).toThrow('原始内容已保留');
 });
 it('retains image display width through normalize, schema serialization and reopening, including reset and old documents', () => {
  const document = (attrs: Record<string, unknown>) => ({ type: 'doc', content: [{ type: 'image', attrs: { resourceId: 'image-id', ...attrs } }] });
  for (const width of [null, 64, 320, 4096]) {
   const original = document({ displayWidth: width, src: 'blob:never-persist', height: 150 });
   const parsed = parseStoredDocument(JSON.stringify(original), 1);
   expect(parsed).toEqual(document({ displayWidth: width }));
   const saved = JSON.stringify(schema.nodeFromJSON(parsed).toJSON());
   expect(parseStoredDocument(saved, 1)).toEqual(document({ displayWidth: width }));
  }
  const oldDocument = parseStoredDocument(JSON.stringify(document({})), 1);
  expect(oldDocument).toEqual(document({}));
  expect(schema.nodeFromJSON(oldDocument).firstChild?.attrs.displayWidth).toBeNull();
  for (const badWidth of [63, 4097, 100.5, -1, '320', '40%']) {
   expect(parseStoredDocument(JSON.stringify(document({ displayWidth: badWidth })), 1)).toEqual(document({}));
  }
  expect(normalizeLogFormatting({ type: 'fileAttachment', attrs: { resourceId: 'file-id', displayWidth: 320 } })).toEqual({ type: 'fileAttachment', attrs: { resourceId: 'file-id' } });
 });
 it('preserves text formatting and open list boundaries when cloning copied resource IDs', () => {
  const paragraph = schema.nodes.paragraph.create(null, schema.text('说明', [schema.marks.bold.create()]));
  const image = schema.nodes.image.create({ resourceId: 'source-image', displayWidth: 320 });
  const file = schema.nodes.fileAttachment.create({ resourceId: 'source-file' });
  const slice = new Slice(Fragment.fromArray([paragraph, image, file, image]), 1, 0);
  expect(sliceResourceIds(slice)).toEqual(['source-image', 'source-file']);
  const copied = remapResourceSlice(slice, new Map([['source-image', 'owned-image'], ['source-file', 'owned-file']]));
  expect(copied.openStart).toBe(1); expect(copied.openEnd).toBe(0);
  expect(copied.content.child(0).toJSON()).toEqual(paragraph.toJSON());
  expect(sliceResourceIds(copied)).toEqual(['owned-image', 'owned-file']);
  expect(copied.content.child(1).attrs.displayWidth).toBe(320);
  expect(sliceResourceIds(slice)).toEqual(['source-image', 'source-file']);
 });
 it('uses image rendering only when the caller and backend both classify the resource as an image', () => {
  expect(resourceNode(metadata)).toEqual({ type: 'image', attrs: { resourceId: 'resource-a' } });
  expect(resourceNode(metadata, true).type).toBe('fileAttachment');
  expect(resourceNode({ ...metadata, isImage: false }).type).toBe('fileAttachment');
  expect(normalizeLogFormatting({ type: 'fileAttachment', attrs: { resourceId: '../unsafe', name: 'x' } })).toEqual({ type: 'fileAttachment', attrs: {} });
 });
 it('pastes mixed rich text and image files without losing formatting or foreign resource ownership', async () => {
  const boldText = schema.nodes.paragraph.create(null, schema.text('实验说明', [schema.marks.bold.create()]));
  const nested = schema.nodes.blockquote.create(null, [
   schema.nodes.bulletList.create(null, schema.nodes.listItem.create(null, [
    schema.nodes.paragraph.create(null, schema.text('列表内容', [schema.marks.italic.create()])),
    schema.nodes.image.create({ resourceId: 'foreign-image' }),
   ])),
  ]);
  const source = new Slice(Fragment.fromArray([boldText, nested]), 1, 0);
  const imageFile = new File([new Uint8Array([1, 2])], 'clipboard.png', { type: 'image/png' });
  const operations: string[] = [];
  const prepared = await prepareResourcePaste(source, [imageFile], schema,
   async id => { operations.push(`clone:${id}`); return { ...metadata, id: 'owned-image' }; },
   async file => { operations.push(`import:${file.name}`); return { ...metadata, id: 'pasted-image' }; },
  );
  expect(operations).toEqual(['clone:foreign-image', 'import:clipboard.png']);
  const destination = schema.nodes.doc.create(null, schema.nodes.paragraph.create());
  const state = EditorState.create({ doc: destination, selection: TextSelection.create(destination, 1) });
  const pasted = state.apply(replaceResourceSelection(state.tr, prepared)).doc;
  expect(() => pasted.check()).not.toThrow();
  expect(pasted.textContent).toBe('实验说明列表内容');
  expect(pasted.child(0).firstChild?.marks.map(mark => mark.type.name)).toEqual(['bold']);
  const listParagraph = pasted.child(1).child(0).child(0).child(0);
  expect(listParagraph.firstChild?.marks.map(mark => mark.type.name)).toEqual(['italic']);
  expect(sliceResourceIds(new Slice(pasted.content, 0, 0))).toEqual(['owned-image', 'pasted-image']);
  expect(JSON.stringify(pasted.toJSON())).not.toContain('foreign-image');
  let images = 0; pasted.descendants(node => { if (node.type.name === 'image') images++; });
  expect(images).toBe(2); // One existing cloned image and one file, each inserted once.
 });
});

describe('resource import boundary', () => {
 it('rejects oversized and invalid image files while allowing ordinary empty files', () => {
  expect(() => validateLogFile({ name: 'empty', size: 0, type: '' })).not.toThrow();
  expect(() => validateLogFile({ name: 'empty.png', size: 0, type: 'image/png' }, true)).toThrow('空图片');
  expect(() => validateLogFile({ name: 'large', size: MAX_LOG_RESOURCE_BYTES + 1, type: '' })).toThrow('20 MiB');
  expect(() => validateLogFile({ name: 'vector.svg', size: 10, type: 'image/svg+xml' }, true)).toThrow('PNG');
  expect(() => validateLogFile({ name: 'legacy.bmp', size: 10, type: 'image/bmp' }, true)).toThrow('PNG');
  expect(() => validateLogFile({ name: 'at-limit.png', size: MAX_LOG_RESOURCE_BYTES, type: 'image/png' }, true)).not.toThrow();
  expect(() => validateLogFile({ name: 'source.zip', size: 3, type: 'application/zip' })).not.toThrow();
 });
 it('sends binary IPC separately from the small encoded ownership context and filename', async () => {
  const bytes = new Uint8Array([0, 2, 255]);
  const file = new File([bytes], '测试 #?.txt', { type: 'text/plain' });
  const context = { repositoryKey: 'D:\\合成库', pageId: 'page-a', expectedRevision: 7 };
  invoke.mockResolvedValueOnce(metadata);
  await expect(logResourceApi.importFile(context, file)).resolves.toEqual(metadata);
  const [command, payload, options] = invoke.mock.calls.at(-1)!;
  expect(command).toBe('log_resource_import_bytes');
  expect(payload).toEqual(bytes);
  expect(JSON.parse(decodeURIComponent(options.headers['x-log-context']))).toEqual(context);
  expect(decodeURIComponent(options.headers['x-file-name'])).toBe(file.name);
  expect(options.headers['x-file-mime']).toBe('text/plain');
 });
 it('formats attachment sizes without loading their binary content', () => {
  expect(formatResourceSize(12)).toBe('12 B');
  expect(formatResourceSize(2048)).toBe('2.0 KiB');
  expect(formatResourceSize(MAX_LOG_RESOURCE_BYTES)).toBe('20.0 MiB');
 });
});

describe('resource operation barrier', () => {
 it('serializes imports and keeps navigation/backup waiting through the final page save', async () => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const events: string[] = []; const busy = vi.fn();
  const queue = new ResourceOperationQueue(busy);
  const first = queue.run(async () => { events.push('import'); await hold; events.push('save'); });
  const second = queue.run(async () => { events.push('second-import-and-save'); });
  let flushed = false;
  const flush = queue.flush().then(() => { flushed = true; });
  await Promise.resolve();
  expect(events).toEqual(['import']); expect(queue.busy).toBe(true); expect(flushed).toBe(false);
  release(); await Promise.all([first, second, flush]);
  expect(events).toEqual(['import', 'save', 'second-import-and-save']);
  expect(flushed).toBe(true); expect(queue.busy).toBe(false); expect(busy).toHaveBeenLastCalledWith(false);
 });
 it('propagates import/save failure to an in-flight flush while permitting a later retry', async () => {
  const queue = new ResourceOperationQueue();
  const task = queue.run(async () => { throw new Error('save rejected'); });
  const flush = queue.flush();
  await expect(task).rejects.toThrow('save rejected');
  await expect(flush).rejects.toThrow('save rejected');
  await expect(queue.run(async () => {})).resolves.toBeUndefined();
  await expect(queue.flush()).resolves.toBeUndefined();
 });
});
