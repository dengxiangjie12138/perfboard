import { describe, expect, it } from 'vitest';
import { describeTrashConfirmation } from './trash';
import type { LogPage, LogProject, LogTrashSnapshot } from './contracts';
const project = (id: string): LogProject => ({ id, title: id, position: 0, revision: 7, createdAt: '', updatedAt: '', deletedAt: 'deleted' });
const page = (id: string, projectId: string): LogPage => ({ id, projectId, title: id, position: 0, revision: 4, createdAt: '', updatedAt: '', deletedAt: 'deleted', schemaVersion: 1, documentJson: '{}' });
const fixture = (): LogTrashSnapshot => ({ projects: [project('deleted-project')], pages: [page('with-project', 'deleted-project'), page('deleted-earlier', 'deleted-project'), page('standalone', 'active-project')], snapshotToken: 'old-warehouse-snapshot' });
describe('permanent-delete confirmation scope', () => {
 it('includes all project pages, including pages deleted before the project', () => {
  const plan = describeTrashConfirmation(fixture(), 'project', 'deleted-project')!;
  expect([plan.projectCount, plan.pageCount]).toEqual([1, 2]);
  expect(plan.titles).toEqual(['项目：deleted-project', '页面：with-project', '页面：deleted-earlier']);
  expect(plan.input).toEqual({ id: 'deleted-project', expectedRevision: 7, snapshotToken: 'old-warehouse-snapshot' });
 });
 it('a page confirmation targets only that page and no project', () => {
  const plan = describeTrashConfirmation(fixture(), 'page', 'standalone')!;
  expect([plan.projectCount, plan.pageCount, plan.titles]).toEqual([0, 1, ['页面：standalone']]);
  expect(plan.input?.expectedRevision).toBe(4);
 });
 it('clear reports entity counts without counting nested pages twice', () => {
  const plan = describeTrashConfirmation(fixture(), 'all')!;
  expect([plan.projectCount, plan.pageCount, plan.titles.length, plan.input]).toEqual([1, 3, 4, null]);
 });
 it('a later restore or new trash item cannot silently change an open confirmation', () => {
  const value = fixture();
  const plan = describeTrashConfirmation(value, 'all')!;
  value.snapshotToken = 'changed';
  value.projects[0].title = 'renamed';
  value.pages.splice(0, 1);
  value.pages.push(page('added-later', 'active-project'));
  expect(plan.snapshotToken).toBe('old-warehouse-snapshot');
  expect(plan.pageCount).toBe(3);
  expect(plan.titles).toContain('页面：with-project');
  expect(plan.titles).not.toContain('页面：added-later');
  expect(Object.isFrozen(plan)).toBe(true);
  expect(Object.isFrozen(plan.titles)).toBe(true);
 });
 it('empty or no-longer-trashed objects cannot present a deletion confirmation', () => {
  expect(describeTrashConfirmation({ projects: [], pages: [], snapshotToken: 'empty' }, 'all')).toBeNull();
  expect(describeTrashConfirmation(fixture(), 'project', 'active-project')).toBeNull();
  expect(describeTrashConfirmation(fixture(), 'page', 'restored')).toBeNull();
 });
});
