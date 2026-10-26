import { Node, mergeAttributes } from '@tiptap/core';
import { Image } from '@tiptap/extension-image';
import { validImageDisplayWidth } from './imageSizing';

const resourceAttributes = () => ({
 resourceId: {
  default: null,
  parseHTML: (element: HTMLElement) => element.getAttribute('data-log-resource-id'),
  renderHTML: (attrs: Record<string, unknown>) => ({ 'data-log-resource-id': attrs.resourceId }),
 },
});
/** Stable resource identity and display size only. Image URLs belong to the node view. */
export const LogImage = Image.extend({
 addAttributes() {
  return {
   ...resourceAttributes(),
   displayWidth: {
    default: null,
    parseHTML: (element: HTMLElement) => {
     const raw = element.getAttribute('data-log-image-width');
     const value = raw === null ? null : Number(raw);
     return validImageDisplayWidth(value) ? value : null;
    },
    renderHTML: (attrs: Record<string, unknown>) => typeof attrs.displayWidth === 'number' && validImageDisplayWidth(attrs.displayWidth) ? { 'data-log-image-width': attrs.displayWidth } : {},
   },
  };
 },
 addInputRules() { return []; },
 parseHTML() { return [{ tag: 'figure[data-log-resource-kind="image"][data-log-resource-id]' }]; },
 renderHTML({ HTMLAttributes }) {
  return ['figure', mergeAttributes(HTMLAttributes, { 'data-log-resource-kind': 'image' }), ['span', {}, '图片']];
 },
});
export const LogFileAttachment = Node.create({
 name: 'fileAttachment',
 group: 'block',
 atom: true,
 draggable: true,
 selectable: true,
 addAttributes: resourceAttributes,
 parseHTML() { return [{ tag: 'div[data-log-resource-kind="fileAttachment"][data-log-resource-id]' }]; },
 renderHTML({ HTMLAttributes }) {
  return ['div', mergeAttributes(HTMLAttributes, { 'data-log-resource-kind': 'fileAttachment' }), ['span', {}, '附件']];
 },
});
