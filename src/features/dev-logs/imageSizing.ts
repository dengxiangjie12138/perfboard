export const MIN_IMAGE_DISPLAY_WIDTH = 64;
export const MAX_IMAGE_DISPLAY_WIDTH = 4096;

export type ImageResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
export type ResizeDragAxis = 'x' | 'y';

/** Only a display preference is stored; original image dimensions/bytes are untouched. */
export function validImageDisplayWidth(value: unknown): value is number | null {
 return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= MIN_IMAGE_DISPLAY_WIDTH && value <= MAX_IMAGE_DISPLAY_WIDTH);
}

export function boundedImageDisplayWidth(width: number, availableWidth: number): number {
 const available = Number.isNaN(availableWidth) ? MIN_IMAGE_DISPLAY_WIDTH : availableWidth;
 const maximum = Math.max(MIN_IMAGE_DISPLAY_WIDTH, Math.min(MAX_IMAGE_DISPLAY_WIDTH, Math.floor(available)));
 const requested = Number.isNaN(width) ? MIN_IMAGE_DISPLAY_WIDTH : width;
 return Math.max(MIN_IMAGE_DISPLAY_WIDTH, Math.min(maximum, Math.round(requested)));
}

function safeRatio(ratio: number): number {
 return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

function finiteOffset(value: number): number {
 return Number.isFinite(value) ? value : 0;
}

/** Choose once after the pointer threshold; the component retains this axis for the gesture. */
export function resizeDragAxis(dx: number, dy: number, aspectRatio: number): ResizeDragAxis {
 return Math.abs(finiteOffset(dx)) >= Math.abs(finiteOffset(dy) * safeRatio(aspectRatio)) ? 'x' : 'y';
}

/** Resize an in-flow image without introducing document position attributes. */
export function resizedImageDisplayWidth(
 startWidth: number, aspectRatio: number, dx: number, dy: number, availableWidth: number,
 corner: ImageResizeCorner = 'se', axis: ResizeDragAxis = resizeDragAxis(dx, dy, aspectRatio),
): number {
 const xSign = corner.endsWith('e') ? 1 : -1;
 const ySign = corner.startsWith('s') ? 1 : -1;
 const delta = axis === 'x' ? finiteOffset(dx) * xSign : finiteOffset(dy) * ySign * safeRatio(aspectRatio);
 const initial = Number.isFinite(startWidth) ? startWidth : MIN_IMAGE_DISPLAY_WIDTH;
 return boundedImageDisplayWidth(initial + delta, availableWidth);
}

/** Arrow keys move the focused corner outward/inward in bounded display-width steps. */
export function cornerResizeDelta(corner: ImageResizeCorner, key: string, step: number): number {
 const amount = Math.abs(finiteOffset(step));
 const xSign = corner.endsWith('e') ? 1 : -1;
 const ySign = corner.startsWith('s') ? 1 : -1;
 if (key === 'ArrowLeft') return -xSign * amount;
 if (key === 'ArrowRight') return xSign * amount;
 if (key === 'ArrowUp') return -ySign * amount;
 if (key === 'ArrowDown') return ySign * amount;
 return 0;
}
