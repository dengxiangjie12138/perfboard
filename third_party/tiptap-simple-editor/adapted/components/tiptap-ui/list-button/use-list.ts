"use client"

import * as React from "react"
import { type Editor } from "@tiptap/react"

// --- Hooks ---
import { useTiptapEditor } from "../../../hooks/use-tiptap-editor"

// --- Icons ---
import { ListIcon } from "../../tiptap-icons/list-icon"
import { ListOrderedIcon } from "../../tiptap-icons/list-ordered-icon"
import { ListTodoIcon } from "../../tiptap-icons/list-todo-icon"

// --- Lib ---
import {
  isNodeInSchema,
  isNodeTypeSelected,
} from "../../../lib/tiptap-utils"

export type ListType = "bulletList" | "orderedList" | "taskList"

/**
 * Configuration for the list functionality
 */
export interface UseListConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null
  /**
   * The type of list to toggle.
   */
  type: ListType
  /**
   * Whether the button should hide when list is not available.
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Callback function called after a successful toggle.
   */
  onToggled?: () => void
}

export const listIcons = {
  bulletList: ListIcon,
  orderedList: ListOrderedIcon,
  taskList: ListTodoIcon,
}

export const listLabels: Record<ListType, string> = {
  bulletList: "Bullet List",
  orderedList: "Ordered List",
  taskList: "Task List",
}

export const LIST_SHORTCUT_KEYS: Record<ListType, string> = {
  bulletList: "mod+shift+8",
  orderedList: "mod+shift+7",
  taskList: "mod+shift+9",
}

/**
 * Checks if a list can be toggled in the current editor state
 */
export function canToggleList(editor: Editor | null, type: ListType): boolean {
  if (!editor?.isEditable || !isNodeInSchema(type, editor) || isNodeTypeSelected(editor, ["image"])) return false
  switch (type) {
    case "bulletList": return editor.can().toggleBulletList()
    case "orderedList": return editor.can().toggleOrderedList()
    case "taskList": return editor.can().toggleList("taskList", "taskItem")
    default: return false
  }
}

/**
 * Checks if list is currently active
 */
export function isListActive(editor: Editor | null, type: ListType): boolean {
  if (!editor || !editor.isEditable) return false

  switch (type) {
    case "bulletList":
      return editor.isActive("bulletList")
    case "orderedList":
      return editor.isActive("orderedList")
    case "taskList":
      return editor.isActive("taskList")
    default:
      return false
  }
}

/**
 * Toggles list in the editor
 */
export function toggleList(editor: Editor | null, type: ListType): boolean {
  if (!editor || !canToggleList(editor, type)) return false
  const chain = editor.chain().focus()
  switch (type) {
    case "bulletList": return chain.toggleBulletList().run()
    case "orderedList": return chain.toggleOrderedList().run()
    case "taskList": return chain.toggleList("taskList", "taskItem").run()
    default: return false
  }
}

/**
 * Determines if the list button should be shown
 */
export function shouldShowButton(props: {
  editor: Editor | null
  type: ListType
  hideWhenUnavailable: boolean
}): boolean {
  const { editor, type, hideWhenUnavailable } = props

  if (!editor || !editor.isEditable) return false
  if (!isNodeInSchema(type, editor)) return false

  if (hideWhenUnavailable && !editor.isActive("code")) {
    return canToggleList(editor, type)
  }

  return true
}

/**
 * Custom hook that provides list functionality for Tiptap editor
 *
 * @example
 * ```tsx
 * // Simple usage
 * function MySimpleListButton() {
 *   const { isVisible, handleToggle, isActive } = useList({ type: "bulletList" })
 *
 *   if (!isVisible) return null
 *
 *   return <button onClick={handleToggle}>Bullet List</button>
 * }
 *
 * // Advanced usage with configuration
 * function MyAdvancedListButton() {
 *   const { isVisible, handleToggle, label, isActive } = useList({
 *     type: "orderedList",
 *     editor: myEditor,
 *     hideWhenUnavailable: true,
 *     onToggled: () => console.log('List toggled!')
 *   })
 *
 *   if (!isVisible) return null
 *
 *   return (
 *     <MyButton
 *       onClick={handleToggle}
 *       aria-label={label}
 *       aria-pressed={isActive}
 *     >
 *       Toggle List
 *     </MyButton>
 *   )
 * }
 * ```
 */
export function useList(config: UseListConfig) {
  const {
    editor: providedEditor,
    type,
    hideWhenUnavailable = false,
    onToggled,
  } = config

  const { editor } = useTiptapEditor(providedEditor)
  const [isVisible, setIsVisible] = React.useState<boolean>(true)
  const canToggle = canToggleList(editor, type)
  const isActive = isListActive(editor, type)

  React.useEffect(() => {
    if (!editor) return

    const handleSelectionUpdate = () => {
      setIsVisible(shouldShowButton({ editor, type, hideWhenUnavailable }))
    }

    handleSelectionUpdate()

    editor.on("selectionUpdate", handleSelectionUpdate)

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate)
    }
  }, [editor, type, hideWhenUnavailable])

  const handleToggle = React.useCallback(() => {
    if (!editor) return false

    const success = toggleList(editor, type)
    if (success) {
      onToggled?.()
    }
    return success
  }, [editor, type, onToggled])

  return {
    isVisible,
    isActive,
    handleToggle,
    canToggle,
    label: listLabels[type],
    shortcutKeys: LIST_SHORTCUT_KEYS[type],
    Icon: listIcons[type],
  }
}
