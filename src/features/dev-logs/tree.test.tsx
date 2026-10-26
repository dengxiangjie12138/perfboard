import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { logDropLocation, logTreeEntries, pageFolder, type LogDragItem } from './tree';
import type { LogSnapshot } from './contracts';
import { LogProjectTree } from './LogProjectTree';
const base = { revision: 1, createdAt: '', updatedAt: '', deletedAt: null };
const snapshot: LogSnapshot = { projects: [{ ...base, id: 'a', title: '项目 A', position: 0 }], pages: [
 { ...base, id: 'one', projectId: 'a', title: '根层页面', position: 1, documentJson: '{}', schemaVersion: 1 },
 { ...base, id: 'two', projectId: 'a', title: '文件夹内页面', position: 0, documentJson: '{}', schemaVersion: 1 },
 { ...base, id: 'trash', projectId: 'a', title: '已删除', position: 2, documentJson: '{}', schemaVersion: 1, deletedAt: 'now' },
], folders: [{ id: 'folder', title: '文件夹', projectId: 'a', revision: 1, position: 0, pageIds: ['two', 'trash'] }] };
const item = (kind: LogDragItem['kind'], id: string, projectId = 'a'): LogDragItem => ({ kind, id, projectId });
describe('folder tree and drop targets', () => {
 it('mixes root folders and pages in persisted order and filters deleted pages', () => {
  expect(logTreeEntries(snapshot, 'a').map(x => x.id)).toEqual(['folder', 'one']);
  expect(logTreeEntries(snapshot, 'a', 'folder').map(x => x.id)).toEqual(['two']);
  expect(pageFolder(snapshot, 'one')).toBeNull(); expect(pageFolder(snapshot, 'two')).toBe('folder');
 });
 it('accepts legacy snapshots without folders', () => {
  expect(logTreeEntries({ ...snapshot, folders: undefined }, 'a').map(x => x.id)).toEqual(['two', 'one']);
 });
 it('moves pages into folders, between folders and back to the project root', () => {
  expect(logDropLocation(snapshot, item('page', 'one'), item('folder', 'folder'))).toEqual({ projectId: 'a', folderId: 'folder', before: null });
  expect(logDropLocation(snapshot, item('page', 'one'), item('page', 'two'))).toEqual({ projectId: 'a', folderId: 'folder', before: { kind: 'page', id: 'two' } });
  expect(logDropLocation(snapshot, item('page', 'two'), item('project', 'a'))).toEqual({ projectId: 'a', folderId: null, before: null });
 });
 it('reorders folders among root entries without accepting a folder inside itself or another folder', () => {
  expect(logDropLocation(snapshot, item('folder', 'another'), item('folder', 'folder'))).toEqual({ projectId: 'a', folderId: null, before: { kind: 'folder', id: 'folder' } });
  expect(logDropLocation(snapshot, item('folder', 'folder'), item('page', 'one'))?.folderId).toBeNull();
  expect(logDropLocation(snapshot, item('folder', 'folder'), item('page', 'two'))).toBeNull();
  expect(logDropLocation(snapshot, item('folder', 'folder'), item('folder', 'folder'))).toBeNull();
 });
 it('rejects cross-project moves and handles project ordering separately', () => {
  expect(logDropLocation(snapshot, item('page', 'one'), item('folder', 'foreign', 'b'))).toBeNull();
  expect(logDropLocation(snapshot, item('project', 'a'), item('project', 'b'))).toBeNull();
 });
 it('places New Folder after New Page and shows the complete project page count', () => {
  const noop = () => {};
  const html = renderToStaticMarkup(<LogProjectTree projects={snapshot.projects} snapshot={snapshot} current={null} selectedProject="a" collapsed={new Set()} busy={false} draggingId="" dropTarget="" rename={null} onToggleProject={noop} onOpenPage={noop} onCreatePage={noop} onCreateFolder={noop} onBeginRename={noop} onCommitRename={async () => {}} onCancelRename={noop} onContext={noop} onDragStart={noop} onDragEnd={noop} onDragOver={noop} onDrop={noop}/>);
  expect(html).toContain('title="项目内全部页面（含文件夹）">2</small>');
  expect(html.indexOf('aria-label="在 项目 A 新建页面"')).toBeLessThan(html.indexOf('aria-label="在 项目 A 新建文件夹"'));
  expect(html).toContain('data-folder-id="folder"');
  expect(html).toContain('data-page-id="two"');
  expect(html).not.toContain('data-page-id="trash"');
 });
});
