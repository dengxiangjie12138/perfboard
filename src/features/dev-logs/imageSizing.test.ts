import { describe, expect, it } from 'vitest';
import {
 boundedImageDisplayWidth, cornerResizeDelta, resizeDragAxis, resizedImageDisplayWidth,
 validImageDisplayWidth, type ImageResizeCorner,
} from './imageSizing';

const corners: { corner: ImageResizeCorner; x: number; y: number }[] = [
 { corner: 'nw', x: -1, y: -1 },
 { corner: 'ne', x: 1, y: -1 },
 { corner: 'sw', x: -1, y: 1 },
 { corner: 'se', x: 1, y: 1 },
];

describe('image display sizing', () => {
 it('accepts optional integer pixel widths and rejects unsafe document attributes', () => {
  for (const width of [null, 64, 640, 4096]) expect(validImageDisplayWidth(width)).toBe(true);
  for (const width of [undefined, 0, -100, 63, 64.5, 4097, NaN, Infinity, '640', '50%', {}, true]) expect(validImageDisplayWidth(width)).toBe(false);
 });
 it.each(corners)('follows outward/inward horizontal and vertical motion at $corner', ({ corner, x, y }) => {
  // Horizontal movement changes width one-for-one; vertical movement scales by the aspect ratio.
  expect(resizedImageDisplayWidth(640, 16 / 9, x * 160, 0, 1000, corner)).toBe(800);
  expect(resizedImageDisplayWidth(640, 16 / 9, -x * 160, 0, 1000, corner)).toBe(480);
  expect(resizedImageDisplayWidth(640, 16 / 9, 0, y * 90, 1000, corner)).toBe(800);
  expect(resizedImageDisplayWidth(640, 16 / 9, 0, -y * 90, 1000, corner)).toBe(480);
  expect(resizedImageDisplayWidth(640, 16 / 9, x * 160, y * 90, 1000, corner)).toBe(800);
  expect(resizedImageDisplayWidth(640, 16 / 9, -x * 320, -y * 180, 1000, corner)).toBe(320);
 });
 it.each(corners)('does not change the measured starting width at $corner', ({ corner }) => {
  expect(resizedImageDisplayWidth(640, 16 / 9, 0, 0, 1000, corner)).toBe(640);
  expect(resizedImageDisplayWidth(640, 16 / 9, 0, 0, 1000, corner, 'y')).toBe(640);
 });
 it('chooses intent using aspect-ratio-normalized movement', () => {
  expect(resizeDragAxis(0, 0, 16 / 9)).toBe('x');
  expect(resizeDragAxis(10, 2, 16 / 9)).toBe('x');
  expect(resizeDragAxis(10, 8, 16 / 9)).toBe('y');
  expect(resizeDragAxis(0, -5, 16 / 9)).toBe('y');
  expect(resizeDragAxis(10, 10, 1)).toBe('x');
  expect(resizeDragAxis(10, 10, 0.5)).toBe('x');
 });
 it.each(corners)('keeps a locked horizontal axis stable through perpendicular motion at $corner', ({ corner, x, y }) => {
  const axis = resizeDragAxis(x * 10, y, 16 / 9);
  expect(axis).toBe('x');
  expect(resizedImageDisplayWidth(640, 16 / 9, x * 40, y * 300, 2000, corner, axis)).toBe(680);
  expect(resizedImageDisplayWidth(640, 16 / 9, x * 41, -y * 300, 2000, corner, axis)).toBe(681);
  expect(resizedImageDisplayWidth(640, 16 / 9, 0, -y * 300, 2000, corner, axis)).toBe(640);
 });
 it.each(corners)('keeps a locked vertical axis stable through perpendicular motion at $corner', ({ corner, x, y }) => {
  const axis = resizeDragAxis(x, y * 10, 2);
  expect(axis).toBe('y');
  expect(resizedImageDisplayWidth(640, 2, x * 300, y * 20, 2000, corner, axis)).toBe(680);
  expect(resizedImageDisplayWidth(640, 2, -x * 300, y * 21, 2000, corner, axis)).toBe(682);
 });
 it.each(corners)('uses correct arrow-key directions at $corner', ({ corner, x, y }) => {
  expect(cornerResizeDelta(corner, 'ArrowRight', 8)).toBe(x * 8);
  expect(cornerResizeDelta(corner, 'ArrowLeft', 8)).toBe(-x * 8);
  expect(cornerResizeDelta(corner, 'ArrowDown', 32)).toBe(y * 32);
  expect(cornerResizeDelta(corner, 'ArrowUp', 32)).toBe(-y * 32);
  expect(cornerResizeDelta(corner, 'Enter', 8)).toBe(0);
 });
 it.each(corners)('limits outward/inward drags at $corner to valid widths', ({ corner, x, y }) => {
  expect(resizedImageDisplayWidth(640, 16 / 9, x * 1000, y * 1000, 782.6, corner)).toBe(782);
  expect(resizedImageDisplayWidth(640, 16 / 9, -x * 10000, -y * 10000, 782, corner)).toBe(64);
  expect(resizedImageDisplayWidth(640, 16 / 9, x * 10000, y * 10000, 9000, corner)).toBe(4096);
 });
 it('keeps widths valid in narrow containers and rounds only the final result', () => {
  expect(boundedImageDisplayWidth(8000, 9000)).toBe(4096);
  expect(boundedImageDisplayWidth(20, 20)).toBe(64); // CSS max-width still fits an exceptionally narrow viewport.
  expect(boundedImageDisplayWidth(320.4, 1000)).toBe(320);
  expect(resizedImageDisplayWidth(320.4, 2, 0.2, 0, 1000)).toBe(321);
 });
 it('handles non-finite input without producing invalid stored widths', () => {
  for (const ratio of [NaN, Infinity, -1, 0]) {
   expect(resizedImageDisplayWidth(640, ratio, 0, 20, 1000, 'se', 'y')).toBe(660);
  }
  expect(resizedImageDisplayWidth(640, 2, NaN, 0, 1000, 'se', 'x')).toBe(640);
  expect(resizedImageDisplayWidth(640, 2, 0, Infinity, 1000, 'se', 'y')).toBe(640);
  expect(resizedImageDisplayWidth(NaN, 2, 0, 0, 1000)).toBe(64);
  expect(boundedImageDisplayWidth(Infinity, 1000)).toBe(1000);
  expect(boundedImageDisplayWidth(-Infinity, 1000)).toBe(64);
  expect(boundedImageDisplayWidth(NaN, 1000)).toBe(64);
  expect(boundedImageDisplayWidth(640, NaN)).toBe(64);
  expect(boundedImageDisplayWidth(640, Infinity)).toBe(640);
  expect(boundedImageDisplayWidth(640, -Infinity)).toBe(64);
  expect(cornerResizeDelta('se', 'ArrowRight', NaN)).toBe(0);
 });
});
