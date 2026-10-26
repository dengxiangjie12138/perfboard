import { expect, it } from 'vitest';
import { rememberedRoute } from './viewMemory';
it('restores known pages and categories without replaying object navigation intents', () => {
  expect(rememberedRoute({page:'notes',category:'学习笔记',noteId:'stale'})).toEqual({page:'notes',category:'学习笔记'});
  expect(rememberedRoute({page:'dev-logs',logPageId:'stale',projectId:'old'})).toEqual({page:'dev-logs'});
  expect(rememberedRoute({page:'uc28-38xx'})).toEqual({page:'uc28-38xx'});
  expect(rememberedRoute({page:'removed-tool'})).toBeUndefined();
});
