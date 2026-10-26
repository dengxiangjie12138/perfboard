# Tiptap SimpleEditor provenance

Perfboard adapts the actual official MIT SimpleEditor template selected by the user.

- Official template documentation: https://tiptap.dev/docs/ui-components/templates/simple-editor
- Official source repository: https://github.com/ueberdosis/tiptap-ui-components
- Immutable upstream commit: `799929bea4804c73767562b69f8acc2acdb8ac86`
- Upstream template: `apps/web/src/components/tiptap-templates/simple/simple-editor.tsx`
- License: MIT, Copyright (c) 2025 Tiptap; the complete original license is retained at `upstream/LICENSE` and copied to `LICENSE`.
- Retrieved for the 2026-10-03 workflow update. `manifest.json` records each pristine file SHA-256 and byte length.
- Runtime Tiptap packages are pinned to `3.31.4` in the host application. The public template repository does not publish a separate template semantic version; the commit above is its source version.

`upstream/` preserves unmodified source, package metadata, README, license, and supporting components. `adapted/` is the imported runtime dependency closure. `adaptation-manifest.json` records its files and deliberate changes. The feature imports `adapted/components/tiptap-templates/simple/simple-editor.tsx`, including the official toolbar, format buttons, list dropdown, link popover, highlight popover, undo/redo controls, hooks, and node styles. It is not a handbuilt editor relabeled as the official template.

Adaptations supply persisted initial document JSON, per-document mounting and undo, read-only lease state, autosave callbacks, an external logical-line gutter, and current-page search. The template demo image uploader and independent demo theme switch are removed. Perfboard theme variables are used; the demo stylesheet's global body/viewport overrides and Google Fonts import are removed, so the editor does not fetch a remote font.

Foreground color uses the free `Color` and `TextStyle` extensions plus Perfboard's small local palette in `src/features/dev-logs/editorExtras.tsx`. No paid `ColorTextPopover` component, subscription, license key, or Tiptap paid registry is used. Highlight controls remain official MIT components, configured with portable hexadecimal colors rather than theme variable expressions.

Current-page search and replace uses the official free MIT `@tiptap/extension-find-and-replace@3.31.4`, documented at https://tiptap.dev/docs/editor/extensions/functionality/find-and-replace. Perfboard supplies the headless extension's controls and intercepts Ctrl+F inside the editor. Search is limited to the mounted page's ProseMirror document.

Line numbers are measured into a sibling DOM gutter. The gutter is `contentEditable=false`, `aria-hidden`, nonselectable, and pointer-inert. It is absent from Tiptap JSON, HTML serialization and clipboard selection. A paragraph/text block or list item receives one number; the first paragraph inside a list item shares its item's number. Soft wraps and hard breaks retain the same logical number.

Local storage is structured JSON with document `schema_version=1`, monotonic revisions and document history in the current warehouse's SQLite. This is a separate feature: existing Excalidraw scenes remain in their original notes schema and format.

The 2026-10-22 adaptation replaces the heading/list/blockquote/code-block helpers' anchor-only NodeSelection and forced end-of-block cursor move with the corresponding native Tiptap commands. This preserves the complete ProseMirror selection, including multi-paragraph and backwards selections, for subsequent formatting. Pristine upstream files remain unchanged.
