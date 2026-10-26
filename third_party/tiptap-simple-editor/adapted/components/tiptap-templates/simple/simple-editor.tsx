// Adapted from official Tiptap MIT SimpleEditor; see ../../../../PROVENANCE.md.
"use client"

import * as React from "react"
import { EditorContent, EditorContext, useEditor, type Editor, type JSONContent } from "@tiptap/react"

// --- Tiptap Core Extensions ---
import { StarterKit } from "@tiptap/starter-kit"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { TextAlign } from "@tiptap/extension-text-align"
import { Typography } from "@tiptap/extension-typography"
import { Highlight } from "@tiptap/extension-highlight"
import { Subscript } from "@tiptap/extension-subscript"
import { Superscript } from "@tiptap/extension-superscript"
import { Selection } from "@tiptap/extensions"
import { Color, TextStyle } from "@tiptap/extension-text-style"
import FindAndReplace from "@tiptap/extension-find-and-replace"
import { ForegroundPalette, FindButton, FindPanel, SearchContext, LogicalGutter } from "../../../../../../src/features/dev-logs/editorExtras"

import { normalizePastedLogSlice } from "../../../../../../src/features/dev-logs/documentFormatting"
import { Fragment, Slice } from "@tiptap/pm/model"
import type { SelectionBookmark } from "@tiptap/pm/state"
import { ImagePlus, Paperclip } from "lucide-react"
import { LogResourceContext, LogImageView, LogFileAttachmentView } from "../../../../../../src/features/dev-logs/resourceNodes"
import { logResourceApi, validateLogFile, type LogResourceController, type LogResourceContext as ResourceContext } from "../../../../../../src/features/dev-logs/resourceApi"
import { prepareResourcePaste, replaceResourceSelection, resourceNode, sliceResourceIds } from "../../../../../../src/features/dev-logs/resourceTransfer"

// --- UI Primitives ---
import { Button } from "../../tiptap-ui-primitive/button"
import { Spacer } from "../../tiptap-ui-primitive/spacer"
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from "../../tiptap-ui-primitive/toolbar"

// --- Tiptap Node ---
import { HorizontalRule } from "../../tiptap-node/horizontal-rule-node/horizontal-rule-node-extension"
import "../../tiptap-node/blockquote-node/blockquote-node.scss"
import "../../tiptap-node/code-block-node/code-block-node.scss"
import "../../tiptap-node/horizontal-rule-node/horizontal-rule-node.scss"
import "../../tiptap-node/list-node/list-node.scss"
import "../../tiptap-node/heading-node/heading-node.scss"
import "../../tiptap-node/paragraph-node/paragraph-node.scss"

// --- Tiptap UI ---
import { HeadingDropdownMenu } from "../../tiptap-ui/heading-dropdown-menu"
import { ListDropdownMenu } from "../../tiptap-ui/list-dropdown-menu"
import { BlockquoteButton } from "../../tiptap-ui/blockquote-button"
import { CodeBlockButton } from "../../tiptap-ui/code-block-button"
import {
  ColorHighlightPopover,
  ColorHighlightPopoverContent,
  ColorHighlightPopoverButton,
} from "../../tiptap-ui/color-highlight-popover"
import {
  LinkPopover,
  LinkContent,
  LinkButton,
} from "../../tiptap-ui/link-popover"
import { MarkButton } from "../../tiptap-ui/mark-button"
import { TextAlignButton } from "../../tiptap-ui/text-align-button"
import { UndoRedoButton } from "../../tiptap-ui/undo-redo-button"

// --- Icons ---
import { ArrowLeftIcon } from "../../tiptap-icons/arrow-left-icon"
import { HighlighterIcon } from "../../tiptap-icons/highlighter-icon"
import { LinkIcon } from "../../tiptap-icons/link-icon"

// --- Hooks ---
import { useIsMobile } from "../../../hooks/use-mobile"
import { useWindowSize } from "../../../hooks/use-window-size"
import { useCursorVisibility } from "../../../hooks/use-cursor-visibility"

// --- Components ---

// --- Lib ---

// --- Styles ---
import "./simple-editor.scss"


const LOG_HIGHLIGHTS = [
  {label: "浅黄", value: "#fff2a8", border: "#e4c558"}, {label: "浅绿", value: "#d9f4de", border: "#7fc992"}, {label: "浅蓝", value: "#d8edff", border: "#79b2e4"}, {label: "浅红", value: "#ffdcdc", border: "#e89898"}, {label: "浅紫", value: "#eadfff", border: "#bca0e4"}
]

const MainToolbarContent = ({
  onHighlighterClick,
  onLinkClick,
  isMobile,
  onImages,
  onFiles,
  readOnly,
}: {
  onHighlighterClick: () => void
  onLinkClick: () => void
  isMobile: boolean
  onImages: () => void
  onFiles: () => void
  readOnly: boolean
}) => {
  return (
    <>
      <Spacer />

      <ToolbarGroup>
        <UndoRedoButton action="undo" />
        <UndoRedoButton action="redo" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <HeadingDropdownMenu levels={[1, 2, 3, 4]} portal={isMobile} />
        <ListDropdownMenu
          types={["bulletList", "orderedList", "taskList"]}
          portal={isMobile}
        />
        <BlockquoteButton />
        <CodeBlockButton />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <MarkButton type="bold" />
        <MarkButton type="italic" />
        <MarkButton type="strike" />
        <MarkButton type="code" />
        <MarkButton type="underline" />
        {!isMobile ? (
          <ColorHighlightPopover colors={LOG_HIGHLIGHTS} />
        ) : (
          <ColorHighlightPopoverButton onClick={onHighlighterClick} />
        )}
        {!isMobile ? <LinkPopover /> : <LinkButton onClick={onLinkClick} />}
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <MarkButton type="superscript" />
        <MarkButton type="subscript" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <TextAlignButton align="left" />
        <TextAlignButton align="center" />
        <TextAlignButton align="right" />
        <TextAlignButton align="justify" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <Button type="button" tooltip="插入图片（每个不超过 20 MiB，同时保存当前页面）" aria-label="插入图片" disabled={readOnly} onClick={onImages}><ImagePlus size={18}/></Button>
        <Button type="button" tooltip="插入文件（每个不超过 20 MiB，同时保存当前页面）" aria-label="插入文件" disabled={readOnly} onClick={onFiles}><Paperclip size={18}/></Button>
      </ToolbarGroup>

      <Spacer />

      {isMobile && <ToolbarSeparator />}

      <ToolbarGroup><ForegroundPalette /><FindButton /></ToolbarGroup>
    </>
  )
}

const MobileToolbarContent = ({
  type,
  onBack,
}: {
  type: "highlighter" | "link"
  onBack: () => void
}) => (
  <>
    <ToolbarGroup>
      <Button data-style="ghost" onClick={onBack}>
        <ArrowLeftIcon className="tiptap-button-icon" />
        {type === "highlighter" ? (
          <HighlighterIcon className="tiptap-button-icon" />
        ) : (
          <LinkIcon className="tiptap-button-icon" />
        )}
      </Button>
    </ToolbarGroup>

    <ToolbarSeparator />

    {type === "highlighter" ? (
      <ColorHighlightPopoverContent colors={LOG_HIGHLIGHTS} />
    ) : (
      <LinkContent />
    )}
  </>
)

export interface SimpleEditorProps { document: JSONContent; readOnly?: boolean; onUpdate: (document: JSONContent) => void; onReady?: (editor: Editor) => void; findRequest?: number; resources?: LogResourceController }

export function SimpleEditor({ document, readOnly = false, onUpdate, onReady, findRequest = 0, resources }: SimpleEditorProps) {
  const [searchOpen, setSearchOpen] = React.useState(false)
  const updateRef = React.useRef(onUpdate)
  updateRef.current = onUpdate
  const lastFindRequest = React.useRef(findRequest)
  React.useEffect(() => { if (findRequest !== lastFindRequest.current) { lastFindRequest.current = findRequest; setSearchOpen(true) } }, [findRequest])
  const contentRef = React.useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()
  const { height } = useWindowSize()
  const [mobileView, setMobileView] = React.useState<
    "main" | "highlighter" | "link"
  >("main")
  const toolbarRef = React.useRef<HTMLDivElement>(null)
  const imageInput = React.useRef<HTMLInputElement>(null)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const editorRef = React.useRef<Editor | null>(null)
  const resourceRef = React.useRef(resources); resourceRef.current = resources
  const readOnlyRef = React.useRef(readOnly); readOnlyRef.current = readOnly

  const insertResources = (buildSlice: (context: ResourceContext, editor: Editor) => Promise<Slice>, position?: number) => {
    const currentEditor = editorRef.current
    const controller = resourceRef.current
    if (!currentEditor || !controller || readOnlyRef.current || !currentEditor.isEditable) return
    let bookmark: SelectionBookmark = currentEditor.state.selection.getBookmark()
    let dropPosition = position
    const mapBookmark = ({ transaction }: { transaction: import("@tiptap/pm/state").Transaction }) => {
      if (dropPosition === undefined) bookmark = bookmark.map(transaction.mapping)
      else dropPosition = transaction.mapping.map(dropPosition)
    }
    currentEditor.on("transaction", mapBookmark)
    void controller.runImport(async context => {
      const slice = await buildSlice(context, currentEditor)
      if (currentEditor.isDestroyed || editorRef.current !== currentEditor || resourceRef.current?.context.pageId !== context.pageId || resourceRef.current?.context.repositoryKey !== context.repositoryKey) throw new Error("页面已切换，附件已留在原库，请重新插入")
      const transaction = currentEditor.state.tr
      if (dropPosition === undefined) transaction.setSelection(bookmark.resolve(transaction.doc))
      currentEditor.view.dispatch(replaceResourceSelection(transaction, slice, dropPosition).scrollIntoView())
    }).catch(controller.onError).finally(() => { currentEditor.off("transaction", mapBookmark) })
  }
  const importFiles = (files: File[], options: { imagesOnly?: boolean; forceAttachment?: boolean; position?: number; clipboardSlice?: Slice } = {}) => {
    if (!files.length) return
    try { files.forEach(file => validateLogFile(file, options.imagesOnly)) } catch (error) { resourceRef.current?.onError(error); return }
    insertResources(async (context, currentEditor) => {
      if (options.clipboardSlice) return prepareResourcePaste(options.clipboardSlice, files, currentEditor.schema, id => logResourceApi.clone(context, id), file => logResourceApi.importFile(context, file))
      const nodes = []
      for (const file of files) {
        const metadata = await logResourceApi.importFile(context, file)
        nodes.push(currentEditor.schema.nodeFromJSON(resourceNode(metadata, options.forceAttachment)))
        if (options.imagesOnly && !metadata.isImage) resourceRef.current?.onNotice?.(`“${metadata.name}”尺寸过大或格式无法预览，已改为附件插入，可打开或另存为查看。`)
      }
      return new Slice(Fragment.fromArray(nodes), 0, 0)
    }, options.position)
  }
  const cloneSlice = (slice: Slice, position?: number) => {
    insertResources((context, currentEditor) => prepareResourcePaste(slice, [], currentEditor.schema, id => logResourceApi.clone(context, id), file => logResourceApi.importFile(context, file)), position)
  }

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      transformPasted: (slice, view) => normalizePastedLogSlice(slice, view.state.schema),
      handlePaste: (_view, event, slice) => {
        if (readOnlyRef.current) return false
        const files = Array.from(event.clipboardData?.files ?? [])
        if (files.length) { event.preventDefault(); event.stopPropagation(); importFiles(files, { clipboardSlice: slice }); return true }
        if (sliceResourceIds(slice).length) { event.preventDefault(); event.stopPropagation(); cloneSlice(slice); return true }
        return false
      },
      handleDrop: (view, event, slice, moved) => {
        if (readOnlyRef.current) return false
        const files = Array.from(event.dataTransfer?.files ?? [])
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        if (position === undefined) return false
        if (files.length) { event.preventDefault(); event.stopPropagation(); importFiles(files, { position }); return true }
        if (!moved && sliceResourceIds(slice).length) { event.preventDefault(); event.stopPropagation(); cloneSlice(slice, position); return true }
        return false
      },
      attributes: {
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        "aria-label": "开发日志正文",
        class: "simple-editor",
      },
    },
    extensions: [
      StarterKit.configure({
        horizontalRule: false,
        link: {
          openOnClick: false,
          enableClickSelection: true,
          protocols: ["http", "https"],
          isAllowedUri: (url) => /^https?:\/\//i.test(url),
        },
      }),
      HorizontalRule,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      Typography,
      Superscript,
      Subscript,
      Selection,
      LogImageView, LogFileAttachmentView,
      TextStyle, Color, FindAndReplace.configure({ searchDebounceMs: 0, injectCSS: false }),
    ],
    content: document,
    editable: !readOnly,
    onUpdate: ({ editor }) => updateRef.current(editor.getJSON()),
  })
  editorRef.current = editor

  React.useEffect(() => { if (editor) { editor.setEditable(!readOnly, false); onReady?.(editor) } }, [editor, readOnly, onReady])

  const rect = useCursorVisibility({
    editor,
    overlayHeight: toolbarRef.current?.getBoundingClientRect().height ?? 0,
  })

  React.useEffect(() => {
    if (!isMobile && mobileView !== "main") {
      setMobileView("main")
    }
  }, [isMobile, mobileView])

  return (
    <div className="simple-editor-wrapper" onKeyDownCapture={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); event.stopPropagation(); setSearchOpen(true) } }}>
      <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden aria-label="选择日志图片" onChange={event => { importFiles(Array.from(event.currentTarget.files ?? []), { imagesOnly: true }); event.currentTarget.value = "" }}/>
      <input ref={fileInput} type="file" multiple hidden aria-label="选择日志附件" onChange={event => { importFiles(Array.from(event.currentTarget.files ?? []), { forceAttachment: true }); event.currentTarget.value = "" }}/>
      <LogResourceContext.Provider value={resources ?? null}>
      <SearchContext.Provider value={{ open: searchOpen, setOpen: setSearchOpen }}>
      <EditorContext.Provider value={{ editor }}>
        <Toolbar
          ref={toolbarRef}
          style={{
            ...(isMobile
              ? {
                  bottom: `calc(100% - ${height - rect.y}px)`,
                }
              : {}),
          }}
        >
          {mobileView === "main" ? (
            <MainToolbarContent
              onHighlighterClick={() => setMobileView("highlighter")}
              onLinkClick={() => setMobileView("link")}
              isMobile={isMobile}
              onImages={() => imageInput.current?.click()}
              onFiles={() => fileInput.current?.click()}
              readOnly={readOnly || !resources}
            />
          ) : (
            <MobileToolbarContent
              type={mobileView === "highlighter" ? "highlighter" : "link"}
              onBack={() => setMobileView("main")}
            />
          )}
        </Toolbar>

        <FindPanel editor={editor} readOnly={readOnly} />
        <div className="log-editor-scroll"><div className="log-editor-sheet" ref={contentRef}><LogicalGutter editor={editor} sheetRef={contentRef} /><EditorContent editor={editor} role="presentation" className="simple-editor-content" /></div></div>
      </EditorContext.Provider>
      </SearchContext.Provider>
      </LogResourceContext.Provider>
    </div>
  )
}
