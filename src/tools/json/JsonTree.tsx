import { useEffect, useRef } from 'react';
import { createJSONEditor, createValueSelection, Mode, type Content } from 'vanilla-jsoneditor';
import { contentToRaw, losslessParser } from './algorithm';

export type JsonTreeApi = { expand: () => void; collapse: () => void; select: (path: (string | number)[]) => void };
export function JsonTree({ raw, onChange, onError, apiRef }: { raw: string; onChange: (raw: string) => void; onError: (message: string) => void; apiRef: { current: JsonTreeApi | null } }) {
  const target = useRef<HTMLDivElement>(null);
  const instance = useRef<ReturnType<typeof createJSONEditor> | null>(null);
  const callbacks = useRef({ onChange, onError });
  useEffect(() => { callbacks.current = { onChange, onError }; }, [onChange, onError]);
  useEffect(() => {
    if (!target.current) return;
    const editor = createJSONEditor({ target: target.current, props: {
      content: { text: raw }, mode: Mode.tree, parser: losslessParser, validationParser: losslessParser,
      mainMenuBar: false, navigationBar: false, statusBar: false, askToFormat: false,
      ariaLabel: 'JSON 树形编辑器', queryLanguages: [], onRenderContextMenu: () => [],
      onChange: (content: Content) => {
        try { callbacks.current.onChange(contentToRaw(content)); }
        catch (error) { callbacks.current.onError(error instanceof Error ? error.message : String(error)); }
      },
      onError: (error: Error) => callbacks.current.onError(error.message),
    } });
    instance.current = editor;
    apiRef.current = {
      // Bounded expansion avoids rendering every node of a large document at once.
      expand: () => editor.expand([], path => path.length < 3),
      collapse: () => editor.collapse([], true),
      select: path => { const editorPath = path.map(String); editor.select(createValueSelection(editorPath)); void editor.scrollTo(editorPath).catch(error => callbacks.current.onError(String(error))); },
    };
    return () => { apiRef.current = null; instance.current = null; void editor.destroy(); };
    // The editor lifetime is independent of its controlled contents.
  }, [apiRef]);
  useEffect(() => {
    const editor = instance.current;
    if (!editor) return;
    try { if (contentToRaw(editor.get()) !== raw) editor.update({ text: raw }); }
    catch (error) { callbacks.current.onError(error instanceof Error ? error.message : String(error)); }
  }, [raw]);
  return <div id="json-tree" className="json-tree" ref={target} />;
}

