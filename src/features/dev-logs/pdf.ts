import type { JSONContent } from '@tiptap/core';
import type { LogPage } from './contracts';
import { parseStoredDocument } from './document';
import { normalizeLogColor } from './documentFormatting';
import type { LogResourceMetadata } from './resourceApi';
import { formatResourceSize } from './resourceTransfer';

export interface PdfResource extends LogResourceMetadata { dataUrl?: string; width?: number; height?: number }
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function logPdfFileName(title: string): string {
 // Windows forbids reserved names even when an extension is present.
 // eslint-disable-next-line no-control-regex
 let name = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '').slice(0, 100).replace(/[. ]+$/, '') || '未命名页面';
 if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
 return name + '.pdf';
}

export function logPdfResourceIds(document: JSONContent, imagesOnly = false): string[] {
 const ids = new Set<string>();
 const visit = (node: JSONContent) => {
  if (node.type === 'image' || (!imagesOnly && node.type === 'fileAttachment')) ids.add(node.attrs!.resourceId);
  node.content?.forEach(visit);
 };
 visit(document);
 return [...ids];
}

/** Serialize the validated document, never the mounted editor DOM or its lazy image views. */
export function renderLogPdfBody(page: Pick<LogPage, 'title' | 'documentJson' | 'schemaVersion'>, resources: ReadonlyMap<string, PdfResource>, projectTitle = ''): string {
 const document = parseStoredDocument(page.documentJson, page.schemaVersion) as JSONContent;
 const render = (node: JSONContent): string => {
  const attrs = node.attrs ?? {};
  if (node.type === 'text') {
   let text = escape(node.text ?? '');
   for (const mark of node.marks ?? []) {
    const tags: Record<string, string> = { bold: 'strong', italic: 'em', strike: 's', code: 'code', underline: 'u', superscript: 'sup', subscript: 'sub' };
    const tag = tags[mark.type];
    if (tag) text = `<${tag}>${text}</${tag}>`;
    else if (mark.type === 'textStyle' || mark.type === 'highlight') {
     const color = normalizeLogColor(mark.attrs?.color);
     if (color) text = `<span style="${mark.type === 'highlight' ? 'background-color' : 'color'}:${color}">${text}</span>`;
    } else if (mark.type === 'link') {
     // The document validator permits only http(s) links. Attribute escaping still matters.
     text = `<a href="${escape(mark.attrs!.href)}">${text}</a>`;
    }
   }
   return text;
  }
  const content = () => (node.content ?? []).map(render).join('');
  const align = ['left', 'center', 'right', 'justify'].includes(attrs.textAlign) ? ` style="text-align:${attrs.textAlign}"` : '';
  switch (node.type) {
   case 'doc': return content();
   case 'paragraph': return `<p${align}>${content() || '<br>'}</p>`;
   case 'heading': return `<h${attrs.level}${align}>${content()}</h${attrs.level}>`;
   case 'hardBreak': return '<br>';
   case 'horizontalRule': return '<hr>';
   case 'bulletList': return `<ul>${content()}</ul>`;
   case 'orderedList': return `<ol start="${attrs.start ?? 1}" type="${attrs.type ?? '1'}">${content()}</ol>`;
   case 'listItem': return `<li>${content()}</li>`;
   case 'taskList': return `<ul class="task-list">${content()}</ul>`;
   case 'taskItem': return `<li class="task-item"><span class="task-check${attrs.checked ? ' checked' : ''}"></span><div>${content()}</div></li>`;
   case 'blockquote': return `<blockquote>${content()}</blockquote>`;
   case 'codeBlock': return `<pre><code>${content()}</code></pre>`;
   case 'image': case 'fileAttachment': {
    const resource = resources.get(attrs.resourceId);
    if (!resource) throw new Error('日志中的图片或附件不存在，请检查页面资源后重试');
    if (node.type === 'fileAttachment') return `<div class="file-attachment">附件：${escape(resource.name)} <small>(${escape(formatResourceSize(resource.size))})</small></div>`;
    if (!resource.isImage || !resource.dataUrl || !/^data:image\/(png|jpeg|gif|webp);base64,[a-z\d+/=]+$/i.test(resource.dataUrl) || !resource.width || !resource.height) throw new Error(`图片“${resource.name}”无法解码，已取消导出`);
    // A4 with 16 mm side margins; cap tall images to fit one printable page with its caption.
    const width = Math.min(resource.width, 178 / 25.4 * 96, 235 / 25.4 * 96 * resource.width / resource.height);
    return `<figure><img src="${resource.dataUrl}" alt="${escape(resource.name)}" style="width:${width.toFixed(2)}px"><figcaption>${escape(resource.name)}</figcaption></figure>`;
   }
   default: throw new Error(`暂不支持导出此日志节点：${node.type}`);
  }
 };
 return `<article>${projectTitle ? `<div class="project-title">${escape(projectTitle)}</div>` : ''}<h1 class="document-title">${escape(page.title.trim() || '未命名页面')}</h1>${render(document)}</article>`;
}

/** Current-page exports use a detached draft snapshot; other pages are read without navigation. */
export async function resolveLogPdfPage(id: string, current: LogPage | null, getPage: (id: string) => Promise<LogPage>): Promise<LogPage> {
 const page = current?.id === id ? { ...current } : await getPage(id);
 if (page.deletedAt) throw new Error('页面已删除，请先从回收站恢复');
 return page;
}
