import { describe, expect, it } from 'vitest';
import { resolveLogSelection } from './selection';
import type { LogPage, LogProject, LogSelection, LogSnapshot } from './contracts';
const project = (id: string, deletedAt: string | null = null): LogProject => ({ id, title: id, position: 0, revision: 1, createdAt: '', updatedAt: '', deletedAt });
const page = (id: string, projectId: string, deletedAt: string | null = null): LogPage => ({ id, projectId, title: id, position: 0, revision: 1, createdAt: '', updatedAt: '', deletedAt, schemaVersion: 1, documentJson: '{}' });
const snapshot: LogSnapshot = { projects: [project('A'), project('B'), project('gone', 'deleted')], pages: [page('a', 'A'), page('b', 'B'), page('deleted', 'A', 'deleted'), page('orphan', 'gone')] };
const saved = (projectId: string | null, pageId: string | null): LogSelection => ({ repositoryKey: 'private', projectId, pageId, hasSavedSelection: true });
describe('warehouse selection restoration', () => {
 it('restores the exact active page, with route intent taking precedence', () => {
  expect(resolveLogSelection(snapshot, saved('A', 'a'))).toEqual({ projectId: 'A', pageId: 'a' });
  expect(resolveLogSelection(snapshot, saved('A', 'a'), { pageId: 'b' })).toEqual({ projectId: 'B', pageId: 'b' });
  expect(resolveLogSelection(snapshot, saved('A', 'a'), { projectId: 'B' })).toEqual({ projectId: 'B', pageId: null });
 });
 it('keeps the project list for saved missing, deleted and mismatched pages', () => {
  for (const id of ['missing', 'deleted', 'b', 'orphan']) expect(resolveLogSelection(snapshot, saved('A', id))).toEqual({ projectId: 'A', pageId: null });
 });
 it('does not substitute an unrelated project when the saved one disappears', () => {
  for (const id of ['missing', 'gone']) expect(resolveLogSelection(snapshot, saved(id, 'a'))).toEqual({ projectId: null, pageId: null });
 });
 it('preserves explicitly cleared or project-only selection', () => {
  expect(resolveLogSelection(snapshot, saved(null, null))).toEqual({ projectId: null, pageId: null });
  expect(resolveLogSelection(snapshot, saved('B', null))).toEqual({ projectId: 'B', pageId: null });
 });
 it('starts an unseen warehouse at its own project list rather than a page', () => {
  expect(resolveLogSelection(snapshot, null)).toEqual({ projectId: 'A', pageId: null });
  expect(resolveLogSelection({ projects: [], pages: [] }, null)).toEqual({ projectId: null, pageId: null });
 });
 it('does not reuse saved intent for invalid explicit routes', () => {
  expect(resolveLogSelection(snapshot, saved('A', 'a'), { pageId: 'missing' })).toEqual({ projectId: null, pageId: null });
  expect(resolveLogSelection(snapshot, saved('A', 'a'), { pageId: 'deleted', projectId: 'B' })).toEqual({ projectId: 'B', pageId: null });
 });
});
