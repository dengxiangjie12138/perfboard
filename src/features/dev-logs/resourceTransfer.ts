import { Fragment, Slice, type Node, type Schema } from '@tiptap/pm/model';
import { Selection, TextSelection, type Transaction } from '@tiptap/pm/state';
import { dropPoint } from '@tiptap/pm/transform';
import type { LogResourceMetadata } from './resourceApi';

export function resourceNode(metadata: LogResourceMetadata, forceAttachment = false) {
 return { type: metadata.isImage && !forceAttachment ? 'image' : 'fileAttachment', attrs: { resourceId: metadata.id } };
}
/** Replace the selection, or insert at an explicit drop position, and leave a
 * writable cursor after a terminal resource for the next import or keystroke. */
export function replaceResourceSelection(transaction: Transaction, slice: Slice, position?: number): Transaction {
 const stepCount = transaction.steps.length;
 if (position === undefined) transaction.replaceSelection(slice);
 else {
  const insertAt = dropPoint(transaction.doc, position, slice) ?? position;
  transaction.replaceRange(insertAt, insertAt, slice);
 }
 let lastNode = slice.content.lastChild;
 while (lastNode?.lastChild) lastNode = lastNode.lastChild;
 const endsWithResource = lastNode?.type.name === 'image' || lastNode?.type.name === 'fileAttachment';
 if ((!endsWithResource && position === undefined) || transaction.steps.length === stepCount) return transaction;
 // This is the same insertion boundary used by ProseMirror's replacement
 // selection. Its resolved selection may already point at a later atom.
 let end: number | undefined;
 transaction.mapping.maps[transaction.steps.length - 1].forEach((_from, _to, _newFrom, newTo) => { end ??= newTo; });
 if (end === undefined) return transaction;
 const $end = transaction.doc.resolve(end);
 if (position !== undefined) {
  // replaceRange does not move the selection to the inserted slice's end.
  let endNode = slice.content.lastChild, endParent: Node | null = null;
  for (let depth = 0; depth < slice.openEnd && endNode; depth++) {
   endParent = endNode;
   endNode = endNode.lastChild;
  }
  transaction.setSelection(Selection.near($end, (endNode ? endNode.isInline : endParent?.isTextblock) ? -1 : 1));
 }
 if (!endsWithResource) return transaction;
 const next = Selection.findFrom($end, 1);
 if (next instanceof TextSelection) return transaction.setSelection(next);
 const paragraph = transaction.doc.type.schema.nodes.paragraph;
 let $insert = $end;
 while (paragraph) {
  if ($insert.parent.canReplaceWith($insert.index(), $insert.index(), paragraph)) {
   transaction.insert($insert.pos, paragraph.create());
   return transaction.setSelection(TextSelection.create(transaction.doc, $insert.pos + 1));
  }
  if (!$insert.depth || $insert.parentOffset !== $insert.parent.content.size) break;
  $insert = transaction.doc.resolve($insert.after());
 }
 return transaction;
}
export function sliceResourceIds(slice: Slice): string[] {
 const ids = new Set<string>();
 slice.content.descendants(node => {
  if ((node.type.name === 'image' || node.type.name === 'fileAttachment') && typeof node.attrs.resourceId === 'string') ids.add(node.attrs.resourceId);
 });
 return [...ids];
}
/** Preserve rich text, marks and open list boundaries while replacing owned resource IDs. */
export function remapResourceSlice(slice: Slice, replacements: ReadonlyMap<string, string>): Slice {
 const mapNode = (node: Node): Node => {
  const resource = node.type.name === 'image' || node.type.name === 'fileAttachment';
  const id = resource ? replacements.get(node.attrs.resourceId) : undefined;
  const children: Node[] = [];
  node.content.forEach(child => children.push(mapNode(child)));
  if (node.isText) return node;
  return node.type.create(id ? { ...node.attrs, resourceId: id } : node.attrs, Fragment.fromArray(children), node.marks);
 };
 const nodes: Node[] = [];
 slice.content.forEach(node => nodes.push(mapNode(node)));
 return new Slice(Fragment.fromArray(nodes), slice.openStart, slice.openEnd);
}
/** A clipboard can contain both rich HTML and files. Keep its parsed content and
 * clone its existing resources before appending the files that HTML did not carry. */
export async function prepareResourcePaste(
 slice: Slice,
 files: readonly File[],
 schema: Schema,
 clone: (id: string) => Promise<LogResourceMetadata>,
 importFile: (file: File) => Promise<LogResourceMetadata>,
): Promise<Slice> {
 const replacements = new Map<string, string>();
 for (const id of sliceResourceIds(slice)) replacements.set(id, (await clone(id)).id);
 const ownedSlice = replacements.size ? remapResourceSlice(slice, replacements) : slice;
 const existingIds = new Set(sliceResourceIds(ownedSlice));
 const imported: Node[] = [];
 for (const file of files) {
  const metadata = await importFile(file);
  if (!existingIds.has(metadata.id)) imported.push(schema.nodeFromJSON(resourceNode(metadata)));
 }
 if (!imported.length) return ownedSlice;
 // The final imported resource is a closed block. Preserve the original open
 // beginning so a copied partial paragraph/list still fits the destination.
 return new Slice(ownedSlice.content.append(Fragment.fromArray(imported)), ownedSlice.openStart, 0);
}
export function formatResourceSize(size: number): string {
 return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MiB` : size >= 1024 ? `${(size / 1024).toFixed(1)} KiB` : `${size} B`;
}
