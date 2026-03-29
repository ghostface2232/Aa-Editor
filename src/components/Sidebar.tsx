import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button, makeStyles, tokens, mergeClasses } from "@fluentui/react-components";
import {
  ArrowExportUpRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  CopyRegular,
  DeleteRegular,
  DismissRegular,
  DocumentAddRegular,
  DocumentCopyRegular,
  DocumentRegular,
  Folder16Regular,
  FolderOpenRegular,
  AddSquareMultipleRegular,
  MoreHorizontalRegular,
  SquareMultipleRegular,
  RenameRegular,
  SettingsRegular,
  SubtractRegular,
  WindowNewRegular,
} from "@fluentui/react-icons";
import { t } from "../i18n";
import type { NoteDoc, NoteGroup } from "../hooks/useNotesLoader";
import type { GroupLayout, Locale, NotesSortOrder } from "../hooks/useSettings";
import { openNewWindow } from "../utils/newWindow";

const SIDE_PADDING = "4px";

const useStyles = makeStyles({
  sidebar: {
    display: "flex",
    flexDirection: "column",
    width: "var(--shell-sidebar-width)",
    height: "100%",
    backgroundColor: "transparent",
    flexShrink: 0,
    userSelect: "none",
  },
  body: {
    flex: 1,
    overflow: "auto",
    paddingTop: "54px",
    paddingLeft: SIDE_PADDING,
    paddingRight: SIDE_PADDING,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  docItemWrapper: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    width: "100%",
  },
  docItemNew: {
    animationName: "docSlideIn",
    animationDuration: "0.2s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
    animationFillMode: "backwards",
  },
  docItemSlideUp: {
    animationName: "docSlideUp",
    animationDuration: "0.2s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
  },
  docItem: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    justifyContent: "flex-start",
    textAlign: "left",
    border: "none",
    borderRadius: "6px",
    fontSize: "13px",
    gap: "5px",
    minHeight: "32px",
    paddingLeft: "8px",
    paddingRight: "8px",
  },
  docItemActive: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    justifyContent: "flex-start",
    textAlign: "left",
    border: "none",
    borderRadius: "6px",
    fontSize: "13px",
    gap: "5px",
    minHeight: "32px",
    paddingLeft: "8px",
    paddingRight: "8px",
    backgroundColor: "var(--ui-active-bg)",
    fontWeight: 500,
  },
  docItemIndented: {
    paddingLeft: "20px",
  },
  newDocItem: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    justifyContent: "flex-start",
    textAlign: "left",
    border: "none",
    borderRadius: "6px",
    fontSize: "13px",
    gap: "8px",
    minHeight: "32px",
    paddingLeft: "8px",
    paddingRight: "8px",
    fontWeight: 500,
  },
  docName: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
    textAlign: "left",
  },
  renameInput: {
    border: "none",
    outline: "none",
    fontSize: "13px",
    fontFamily: "inherit",
    lineHeight: "20px",
    padding: "2px 6px",
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    minWidth: 0,
    flex: 1,
    borderRadius: "3px",
    marginLeft: "-6px",
  },
  moreBtn: {
    position: "absolute",
    right: "4px",
    top: "50%",
    transform: "translateY(-50%)",
    border: "none",
    borderRadius: "4px",
    minWidth: "auto",
    width: "24px",
    height: "24px",
    padding: "0",
    opacity: 0,
    pointerEvents: "none",
    transitionProperty: "opacity",
    transitionDuration: "0.1s",
  },
  moreBtnVisible: {
    opacity: 1,
    pointerEvents: "auto",
  },
  moreBtnActive: {
    opacity: 1,
    pointerEvents: "auto",
    backgroundColor: "var(--ui-active-bg)",
  },
  docTrailing: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    flexShrink: 0,
    transitionProperty: "opacity",
    transitionDuration: "0.1s",
  },
  docTrailingHidden: {
    opacity: 0,
    pointerEvents: "none",
  },
  docTimestamp: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    opacity: 0.7,
    flexShrink: 0,
    whiteSpace: "nowrap",
  },
  dirtyDot: {
    fontSize: "8px",
    color: tokens.colorNeutralForeground3,
    opacity: 0.7,
    flexShrink: 0,
    lineHeight: 1,
  },
  empty: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground3,
    lineHeight: "1.6",
    paddingTop: "10px",
    paddingLeft: "8px",
    paddingRight: "8px",
  },
  footer: {
    flexShrink: 0,
    paddingLeft: SIDE_PADDING,
    paddingRight: SIDE_PADDING,
    paddingBottom: "6px",
  },
  settingsBtn: {
    width: "100%",
    justifyContent: "flex-start",
    border: "none",
    borderRadius: "6px",
    fontSize: "13px",
    gap: "8px",
    minHeight: "36px",
    paddingLeft: "8px",
    paddingRight: "8px",
  },
  contextMenu: {
    position: "fixed",
    zIndex: 1000,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow16,
    padding: "4px",
    minWidth: "160px",
  },
  contextMenuItem: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    justifyContent: "flex-start",
    textAlign: "left",
    border: "none",
    borderRadius: "4px",
    fontSize: "13px",
    gap: "8px",
    minHeight: "32px",
    paddingLeft: "8px",
    paddingRight: "12px",
  },
  contextMenuDanger: {
    color: tokens.colorPaletteRedForeground1,
  },
  submenuParent: {
    position: "relative",
  },
  submenuArrow: {
    marginLeft: "auto",
    fontSize: "10px",
    color: tokens.colorNeutralForeground3,
  },
  submenu: {
    position: "fixed",
    zIndex: 1001,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow16,
    padding: "4px",
    minWidth: "140px",
  },
  searchBoxWrapper: {
    overflow: "hidden",
    maxHeight: "0px",
    opacity: 0,
    transitionProperty: "max-height, opacity, margin-bottom",
    transitionDuration: "0.2s",
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
    marginBottom: "0px",
  },
  searchBoxWrapperOpen: {
    maxHeight: "40px",
    opacity: 1,
    marginBottom: "4px",
  },
  searchBox: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    paddingLeft: "6px",
    paddingRight: "2px",
  },
  searchInput: {
    flex: 1,
    border: "none",
    outline: "none",
    fontSize: "13px",
    fontFamily: "inherit",
    lineHeight: "28px",
    padding: "0 8px 0 14px",
    backgroundColor: "var(--sidebar-search-bg, rgba(0, 0, 0, 0.06))",
    color: tokens.colorNeutralForeground1,
    borderRadius: "6px",
    minWidth: 0,
    "::placeholder": {
      color: tokens.colorNeutralForeground4,
    },
  },
  searchCloseBtn: {
    border: "none",
    borderRadius: "4px",
    minWidth: "auto",
    width: "24px",
    height: "24px",
    padding: "0",
    flexShrink: 0,
  },
  /* ─── Group styles ─── */
  groupHeader: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    width: "100%",
    justifyContent: "flex-start",
    textAlign: "left",
    border: "none",
    borderRadius: "6px",
    fontSize: "13px",
    gap: "4px",
    minHeight: "32px",
    paddingLeft: "6px",
    paddingRight: "8px",
    cursor: "pointer",
  },
  groupChevron: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "16px",
    height: "16px",
    flexShrink: 0,
    color: tokens.colorNeutralForeground3,
  },
  groupName: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
    textAlign: "left",
  },
  groupCount: {
    fontSize: "9px",
    fontWeight: 600,
    color: tokens.colorNeutralBackground1,
    backgroundColor: tokens.colorNeutralForeground3,
    opacity: 0.7,
    mixBlendMode: "soft-light",
    borderRadius: "100px",
    minWidth: "15px",
    height: "15px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: "4px",
    paddingRight: "4px",
    paddingTop: "1px",
    flexShrink: 0,
    lineHeight: 1,
    transitionProperty: "opacity",
    transitionDuration: "0.1s",
  },
  groupNameInput: {
    border: "none",
    outline: "none",
    fontSize: "13px",
    fontFamily: "inherit",
    lineHeight: "20px",
    padding: "2px 6px",
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    minWidth: 0,
    flex: 1,
    borderRadius: "3px",
  },
  /* ─── Multi-select ─── */
  selectCheckbox: {
    width: "16px",
    height: "16px",
    flexShrink: 0,
    cursor: "pointer",
    borderRadius: "3px",
    border: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.colorNeutralForeground1,
    opacity: 0.15,
    transitionProperty: "opacity, background-color",
    transitionDuration: "0.15s",
    padding: 0,
    color: tokens.colorNeutralForeground1,
    fontSize: "14px",
    lineHeight: 1,
  },
  selectCheckboxChecked: {
    opacity: 1,
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralBackground1,
  },
  selectToolbar: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    paddingLeft: SIDE_PADDING,
    paddingRight: SIDE_PADDING,
    paddingBottom: "4px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingTop: "4px",
  },
  selectInfo: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    paddingLeft: "8px",
    paddingBottom: "2px",
  },
});

function formatTimestamp(ts: number, locale: Locale): string {
  const now = Date.now();
  const diff = now - ts;
  const ONE_DAY = 24 * 60 * 60 * 1000;

  if (diff < ONE_DAY) {
    const date = new Date(ts);
    const h = date.getHours();
    const m = date.getMinutes().toString().padStart(2, "0");
    if (locale === "ko") {
      return `${h >= 12 ? "오후" : "오전"} ${h % 12 || 12}:${m}`;
    }
    const ampm = h >= 12 ? "PM" : "AM";
    return `${h % 12 || 12}:${m} ${ampm}`;
  }

  const date = new Date(ts);
  if (locale === "ko") {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

interface SidebarProps {
  docs: NoteDoc[];
  activeIndex: number;
  onSwitchDocument: (index: number) => void;
  onNewNote: () => void;
  onDeleteNote: (index: number) => void;
  onCloseNote: (index: number) => void;
  onDuplicateNote: (index: number) => void;
  onExportNote: (index: number) => void;
  onRenameNote: (index: number, newName: string) => void;
  onOpenFile: () => void;
  notesSortOrder: NotesSortOrder;
  locale: Locale;
  onOpenSettings: () => void;
  sidebarSearchOpen: boolean;
  sidebarSearchQuery: string;
  onSidebarSearchQueryChange: (query: string) => void;
  onSidebarSearchClose: () => void;
  /* ─── Group props ─── */
  groups: NoteGroup[];
  groupLayout: GroupLayout;
  onCreateGroup: (name: string, initialNoteIds?: string[]) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onUngroupGroup: (groupId: string) => void;
  onAddNoteToGroup: (noteId: string, groupId: string) => void;
  onRemoveNoteFromGroup: (noteId: string) => void;
  onMoveNotesToGroup: (noteIds: string[], groupId: string) => void;
  onToggleGroupCollapsed: (groupId: string) => void;
  onDeleteNotes: (indices: number[]) => void;
  /* ─── Select mode (controlled from App) ─── */
  selectMode: boolean;
  onSelectModeChange: (mode: boolean) => void;
  creatingGroup: boolean;
  onCreatingGroupChange: (creating: boolean) => void;
}

interface ContextMenuState {
  type: "note" | "empty" | "group";
  index: number;
  groupId?: string;
  x: number;
  y: number;
}

export function Sidebar({
  docs,
  activeIndex,
  onSwitchDocument,
  onNewNote,
  onDeleteNote,
  onCloseNote,
  onDuplicateNote,
  onExportNote,
  onRenameNote,
  onOpenFile,
  notesSortOrder,
  locale,
  onOpenSettings,
  sidebarSearchOpen,
  sidebarSearchQuery,
  onSidebarSearchQueryChange,
  onSidebarSearchClose,
  groups,
  groupLayout,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onUngroupGroup,
  onAddNoteToGroup,
  onRemoveNoteFromGroup,
  onMoveNotesToGroup,
  onToggleGroupCollapsed,
  onDeleteNotes,
  selectMode,
  onSelectModeChange,
  creatingGroup,
  onCreatingGroupChange,
}: SidebarProps) {
  const styles = useStyles();
  const i = (key: Parameters<typeof t>[0]) => t(key, locale);

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupValue, setEditingGroupValue] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [submenuPos, setSubmenuPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());

  const inputRef = useRef<HTMLInputElement>(null);
  const groupInputRef = useRef<HTMLInputElement>(null);
  const newGroupInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const submenuParentRef = useRef<HTMLDivElement>(null);
  const submenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup submenu timer on unmount
  useEffect(() => {
    return () => { if (submenuTimerRef.current) clearTimeout(submenuTimerRef.current); };
  }, []);

  // Build grouped note id set
  const groupedNoteIds = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) for (const id of g.noteIds) set.add(id);
    return set;
  }, [groups]);

  // Focus sidebar search input when opened
  useEffect(() => {
    if (sidebarSearchOpen) {
      searchInputRef.current?.focus();
    }
  }, [sidebarSearchOpen]);

  // Detect added/removed docs for animation
  const prevDocListRef = useRef<string[]>(docs.map((d) => d.id));
  const [newDocIds, setNewDocIds] = useState<Set<string>>(new Set());
  const [slideUpFromIndex, setSlideUpFromIndex] = useState(-1);

  useEffect(() => {
    const prevList = prevDocListRef.current;
    const prevSet = new Set(prevList);
    const currentIds = docs.map((d) => d.id);
    const currentSet = new Set(currentIds);
    const timers: ReturnType<typeof setTimeout>[] = [];

    const added = new Set<string>();
    for (const id of currentIds) {
      if (!prevSet.has(id)) added.add(id);
    }
    if (added.size > 0) {
      setNewDocIds(added);
      timers.push(setTimeout(() => setNewDocIds(new Set()), 250));
    }

    if (currentIds.length < prevList.length) {
      for (let idx = 0; idx < prevList.length; idx++) {
        if (!currentSet.has(prevList[idx])) {
          setSlideUpFromIndex(idx);
          timers.push(setTimeout(() => setSlideUpFromIndex(-1), 250));
          break;
        }
      }
    }

    prevDocListRef.current = currentIds;
    return () => timers.forEach(clearTimeout);
  }, [docs]);

  // Clear selection when exiting select mode
  useEffect(() => {
    if (!selectMode) setSelectedNoteIds(new Set());
  }, [selectMode]);

  // Focus new-group input when creatingGroup becomes true
  useEffect(() => {
    if (!creatingGroup) return;
    setNewGroupName("");
    const id = setTimeout(() => newGroupInputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [creatingGroup]);

  // Filter docs by search query
  const filteredDocs = useMemo(() => {
    if (!sidebarSearchQuery) return docs.map((doc, index) => ({ doc, originalIndex: index }));
    const q = sidebarSearchQuery.toLowerCase();
    return docs
      .map((doc, index) => ({ doc, originalIndex: index }))
      .filter(({ doc }) => doc.fileName.toLowerCase().includes(q));
  }, [docs, sidebarSearchQuery]);

  // Focus the rename input when editing starts
  useEffect(() => {
    if (editingIndex !== null && inputRef.current) {
      inputRef.current.focus();
      const doc = docs[editingIndex];
      if (doc?.isExternal) {
        const dotIndex = editingValue.lastIndexOf(".");
        if (dotIndex > 0) {
          inputRef.current.setSelectionRange(0, dotIndex);
        } else {
          inputRef.current.select();
        }
      } else {
        inputRef.current.select();
      }
    }
  }, [editingIndex]);

  // Focus group rename input
  useEffect(() => {
    if (editingGroupId !== null && groupInputRef.current) {
      groupInputRef.current.focus();
      groupInputRef.current.select();
    }
  }, [editingGroupId]);

  /* ─── Callbacks ─── */

  const commitRename = useCallback(() => {
    if (editingIndex !== null) {
      const trimmed = editingValue.trim();
      if (trimmed && trimmed !== docs[editingIndex]?.fileName) {
        onRenameNote(editingIndex, trimmed);
      }
      setEditingIndex(null);
    }
  }, [editingIndex, editingValue, docs, onRenameNote]);

  const commitGroupRename = useCallback(() => {
    if (editingGroupId !== null) {
      const trimmed = editingGroupValue.trim();
      if (trimmed) {
        onRenameGroup(editingGroupId, trimmed);
      }
      setEditingGroupId(null);
    }
  }, [editingGroupId, editingGroupValue, onRenameGroup]);

  const commitNewGroup = useCallback(() => {
    const trimmed = newGroupName.trim();
    if (trimmed) {
      onCreateGroup(trimmed);
    }
    onCreatingGroupChange(false);
  }, [newGroupName, onCreateGroup, onCreatingGroupChange]);

  const handleDoubleClick = useCallback((index: number) => {
    setEditingIndex(index);
    setEditingValue(docs[index].fileName);
  }, [docs]);

  const handleMoreClick = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenu({ type: "note", index, x: rect.left, y: rect.bottom + 2 });
  }, []);

  const handleGroupMoreClick = useCallback((groupId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenu({ type: "group", index: -1, groupId, x: rect.left, y: rect.bottom + 2 });
  }, []);

  const handleContextMenu = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const wrapper = (e.currentTarget as HTMLElement);
    const moreBtn = wrapper.querySelector<HTMLElement>("[data-more-btn]");
    if (moreBtn) {
      const rect = moreBtn.getBoundingClientRect();
      setContextMenu({ type: "note", index, x: rect.left, y: rect.bottom + 2 });
    } else {
      setContextMenu({ type: "note", index, x: e.clientX, y: e.clientY });
    }
  }, []);

  const handleGroupContextMenu = useCallback((groupId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const wrapper = (e.currentTarget as HTMLElement);
    const moreBtn = wrapper.querySelector<HTMLElement>("[data-more-btn]");
    if (moreBtn) {
      const rect = moreBtn.getBoundingClientRect();
      setContextMenu({ type: "group", index: -1, groupId, x: rect.left, y: rect.bottom + 2 });
    } else {
      setContextMenu({ type: "group", index: -1, groupId, x: e.clientX, y: e.clientY });
    }
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    setSubmenuOpen(false);
    setSubmenuPos(null);
  }, []);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handleOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };
    window.addEventListener("mousedown", handleOutside);
    return () => window.removeEventListener("mousedown", handleOutside);
  }, [contextMenu, closeContextMenu]);

  const handleCopyContent = useCallback((index: number) => {
    const doc = docs[index];
    if (doc) {
      navigator.clipboard.writeText(doc.content).catch(() => {});
    }
    closeContextMenu();
  }, [docs, closeContextMenu]);

  const toggleNoteSelection = useCallback((noteId: string) => {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }, []);

  const getGroupForNote = useCallback((noteId: string): NoteGroup | null => {
    return groups.find((g) => g.noteIds.includes(noteId)) ?? null;
  }, [groups]);

  /* ─── Submenu position calculation ─── */
  const showSubmenu = useCallback(() => {
    if (submenuTimerRef.current) clearTimeout(submenuTimerRef.current);
    setSubmenuOpen(true);
    if (submenuParentRef.current) {
      const rect = submenuParentRef.current.getBoundingClientRect();
      setSubmenuPos({ x: rect.right - 4, y: rect.top });
    }
  }, []);

  const hideSubmenu = useCallback(() => {
    submenuTimerRef.current = setTimeout(() => {
      setSubmenuOpen(false);
      setSubmenuPos(null);
    }, 150);
  }, []);

  const keepSubmenu = useCallback(() => {
    if (submenuTimerRef.current) clearTimeout(submenuTimerRef.current);
  }, []);

  /* ─── Render helpers ─── */

  const isSearching = !!sidebarSearchQuery;

  // Compute render items: when not searching, organize by groups
  type RenderItem =
    | { kind: "note"; doc: NoteDoc; originalIndex: number; indented: boolean }
    | { kind: "group"; group: NoteGroup }
    | { kind: "newGroup" };

  const renderItems = useMemo((): RenderItem[] => {
    if (isSearching) {
      return filteredDocs.map(({ doc, originalIndex }) => ({
        kind: "note" as const,
        doc,
        originalIndex,
        indented: false,
      }));
    }

    const items: RenderItem[] = [];
    const docsMap = new Map(docs.map((d, i) => [d.id, { doc: d, originalIndex: i }]));

    const ungrouped = filteredDocs.filter(({ doc }) => !groupedNoteIds.has(doc.id));

    if (groupLayout === "groups-first") {
      // Groups first
      for (const group of groups) {
        items.push({ kind: "group", group });
        if (!group.collapsed) {
          for (const noteId of group.noteIds) {
            const entry = docsMap.get(noteId);
            if (entry) items.push({ kind: "note", doc: entry.doc, originalIndex: entry.originalIndex, indented: true });
          }
        }
      }
      // New group input placeholder
      if (creatingGroup) items.push({ kind: "newGroup" });
      // Ungrouped notes
      for (const { doc, originalIndex } of ungrouped) {
        items.push({ kind: "note", doc, originalIndex, indented: false });
      }
    } else {
      // Mixed: interleave groups and ungrouped notes by timestamp
      type Slot =
        | { ts: number; entry: RenderItem; children?: RenderItem[] }
        ;

      const slots: Slot[] = [];

      for (const group of groups) {
        const children: RenderItem[] = [];
        if (!group.collapsed) {
          for (const noteId of group.noteIds) {
            const entry = docsMap.get(noteId);
            if (entry) children.push({ kind: "note", doc: entry.doc, originalIndex: entry.originalIndex, indented: true });
          }
        }
        slots.push({ ts: group.createdAt, entry: { kind: "group", group }, children });
      }

      for (const { doc, originalIndex } of ungrouped) {
        const ts = notesSortOrder.startsWith("created") ? doc.createdAt : doc.updatedAt;
        slots.push({ ts, entry: { kind: "note", doc, originalIndex, indented: false } });
      }

      const desc = notesSortOrder.endsWith("-desc");
      slots.sort((a, b) => desc ? b.ts - a.ts : a.ts - b.ts);

      for (const slot of slots) {
        items.push(slot.entry);
        if (slot.children) items.push(...slot.children);
      }

      if (creatingGroup) items.push({ kind: "newGroup" });
    }

    return items;
  }, [isSearching, filteredDocs, docs, groups, groupedNoteIds, groupLayout, notesSortOrder, creatingGroup]);

  const renderNoteItem = (doc: NoteDoc, originalIndex: number, indented: boolean) => {
    const isSelected = selectedNoteIds.has(doc.id);
    const isHovered = hoveredIndex === originalIndex;
    const isContextTarget = contextMenu?.type === "note" && contextMenu.index === originalIndex;

    return (
      <div
        key={doc.id}
        data-doc-item
        className={mergeClasses(
          styles.docItemWrapper,
          newDocIds.has(doc.id) && styles.docItemNew,
          slideUpFromIndex >= 0 && originalIndex >= slideUpFromIndex && styles.docItemSlideUp,
        )}
        onMouseEnter={() => setHoveredIndex(originalIndex)}
        onMouseLeave={() => setHoveredIndex(null)}
        onContextMenu={(e) => !selectMode && handleContextMenu(originalIndex, e)}
      >
        {selectMode && (
          <button
            className={mergeClasses(styles.selectCheckbox, isSelected && styles.selectCheckboxChecked)}
            onClick={(e) => { e.stopPropagation(); toggleNoteSelection(doc.id); }}
            style={{ marginLeft: indented ? "16px" : "4px" }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: isSelected ? 1 : 0 }}>
              <path d="M1.5 5.5L4 8L8.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {editingIndex === originalIndex ? (
          <Button
            appearance="subtle"
            icon={doc.isExternal ? <Folder16Regular /> : <DocumentRegular />}
            className={mergeClasses(
              originalIndex === activeIndex ? styles.docItemActive : styles.docItem,
              indented && !selectMode && styles.docItemIndented,
            )}
            size="small"
            style={{ pointerEvents: "none" }}
          >
            <input
              ref={inputRef}
              className={styles.renameInput}
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                if (e.key === "Escape") { e.preventDefault(); setEditingIndex(null); }
              }}
              style={{ pointerEvents: "auto" }}
            />
          </Button>
        ) : (
          <>
            <Button
              appearance="subtle"
              icon={doc.isExternal ? <Folder16Regular /> : <DocumentRegular />}
              className={mergeClasses(
                originalIndex === activeIndex ? styles.docItemActive : styles.docItem,
                indented && !selectMode && styles.docItemIndented,
              )}
              onClick={() => {
                if (selectMode) {
                  toggleNoteSelection(doc.id);
                } else {
                  onSwitchDocument(originalIndex);
                }
              }}
              size="small"
            >
              <span className={styles.docName}>{doc.fileName}</span>
              <span className={mergeClasses(
                styles.docTrailing,
                (isHovered || isContextTarget) && styles.docTrailingHidden,
              )}>
                {doc.isDirty && doc.isExternal && (
                  <span className={styles.dirtyDot}>●</span>
                )}
                <span className={styles.docTimestamp}>
                  {formatTimestamp(
                    notesSortOrder.startsWith("created") ? doc.createdAt : doc.updatedAt,
                    locale,
                  )}
                </span>
              </span>
            </Button>

            {!selectMode && (
              <Button
                data-more-btn
                appearance="subtle"
                className={mergeClasses(
                  styles.moreBtn,
                  isContextTarget
                    ? styles.moreBtnActive
                    : isHovered && styles.moreBtnVisible,
                )}
                onClick={(e) => handleMoreClick(originalIndex, e)}
                size="small"
              >
                <MoreHorizontalRegular fontSize={16} />
              </Button>
            )}
          </>
        )}
      </div>
    );
  };

  const renderGroupHeader = (group: NoteGroup) => {
    const isEditing = editingGroupId === group.id;
    const isGroupHovered = hoveredGroupId === group.id;
    const isContextTarget = contextMenu?.type === "group" && contextMenu.groupId === group.id;
    const noteCount = group.noteIds.filter((id) => docs.some((d) => d.id === id)).length;

    return (
      <div
        key={`group-${group.id}`}
        data-group-item
        className={styles.docItemWrapper}
        onMouseEnter={() => setHoveredGroupId(group.id)}
        onMouseLeave={() => setHoveredGroupId(null)}
        onContextMenu={(e) => handleGroupContextMenu(group.id, e)}
      >
        <Button
          appearance="subtle"
          className={styles.groupHeader}
          size="small"
          onClick={() => !isEditing && onToggleGroupCollapsed(group.id)}
        >
          <span className={styles.groupChevron}>
            {group.collapsed
              ? <ChevronRightRegular fontSize={12} />
              : <ChevronDownRegular fontSize={12} />}
          </span>
          {isEditing ? (
            <input
              ref={groupInputRef}
              className={styles.groupNameInput}
              value={editingGroupValue}
              onChange={(e) => setEditingGroupValue(e.target.value)}
              onBlur={commitGroupRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitGroupRename(); }
                if (e.key === "Escape") { e.preventDefault(); setEditingGroupId(null); }
              }}
              onClick={(e) => e.stopPropagation()}
              style={{ pointerEvents: "auto" }}
            />
          ) : (
            <>
              <span className={styles.groupName}>{group.name}</span>
              <span className={mergeClasses(
                styles.groupCount,
                (isGroupHovered || isContextTarget) && styles.docTrailingHidden,
              )}>{noteCount}</span>
            </>
          )}
        </Button>

        {!isEditing && (
          <Button
            data-more-btn
            appearance="subtle"
            className={mergeClasses(
              styles.moreBtn,
              isContextTarget
                ? styles.moreBtnActive
                : isGroupHovered && styles.moreBtnVisible,
            )}
            onClick={(e) => handleGroupMoreClick(group.id, e)}
            size="small"
          >
            <MoreHorizontalRegular fontSize={16} />
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className={styles.sidebar}>
      <div
        className={styles.body}
        data-sidebar-body
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest("[data-doc-item]")) return;
          if ((e.target as HTMLElement).closest("[data-group-item]")) return;
          e.preventDefault();
          e.stopPropagation();
          setContextMenu({ type: "empty", index: -1, x: e.clientX, y: e.clientY });
        }}
      >
        <div className={mergeClasses(styles.searchBoxWrapper, sidebarSearchOpen && styles.searchBoxWrapperOpen)}>
          <div className={styles.searchBox}>
            <input
              ref={searchInputRef}
              className={styles.searchInput}
              value={sidebarSearchQuery}
              onChange={(e) => onSidebarSearchQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onSidebarSearchClose();
                }
              }}
              placeholder={i("search.sidebarPlaceholder")}
              spellCheck={false}
              tabIndex={sidebarSearchOpen ? 0 : -1}
            />
            <Button
              appearance="subtle"
              className={styles.searchCloseBtn}
              onClick={onSidebarSearchClose}
              size="small"
              tabIndex={sidebarSearchOpen ? 0 : -1}
            >
              <DismissRegular fontSize={14} />
            </Button>
          </div>
        </div>

        <Button
          appearance="subtle"
          icon={<DocumentAddRegular />}
          className={styles.newDocItem}
          onClick={onNewNote}
          size="small"
        >
          {i("sidebar.newNote")}
        </Button>

        {renderItems.length === 0 && !creatingGroup ? (
          <span className={styles.empty}>{sidebarSearchQuery ? "" : i("sidebar.empty")}</span>
        ) : (
          renderItems.map((item) => {
            if (item.kind === "note") {
              return renderNoteItem(item.doc, item.originalIndex, item.indented);
            }
            if (item.kind === "group") {
              return renderGroupHeader(item.group);
            }
            if (item.kind === "newGroup") {
              return (
                <div key="new-group-input" className={styles.docItemWrapper}>
                  <Button
                    appearance="subtle"
                    className={styles.groupHeader}
                    size="small"
                    style={{ pointerEvents: "none" }}
                  >
                    <span className={styles.groupChevron}>
                      <ChevronDownRegular fontSize={12} />
                    </span>
                    <input
                      ref={newGroupInputRef}
                      className={styles.groupNameInput}
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      onBlur={commitNewGroup}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitNewGroup(); }
                        if (e.key === "Escape") { e.preventDefault(); onCreatingGroupChange(false); }
                      }}
                      placeholder={i("sidebar.groupNamePlaceholder")}
                      style={{ pointerEvents: "auto" }}
                    />
                  </Button>
                </div>
              );
            }
            return null;
          })
        )}
      </div>

      {/* Multi-select toolbar */}
      {selectMode && (
        <div className={styles.selectToolbar}>
          <span className={styles.selectInfo}>
            {selectedNoteIds.size}{i("sidebar.nSelected")}
          </span>
          {groups.length > 0 && selectedNoteIds.size > 0 && (
            <Button
              appearance="subtle"
              icon={<SquareMultipleRegular />}
              className={styles.settingsBtn}
              size="small"
              onClick={() => {
                // Show a simple context menu with group choices at center of sidebar
                const body = document.querySelector("[data-sidebar-body]");
                const rect = body?.getBoundingClientRect();
                setContextMenu({
                  type: "empty",
                  index: -2, // special: select-mode move-to-group
                  x: rect ? rect.left + rect.width / 2 : 100,
                  y: rect ? rect.top + 60 : 100,
                });
              }}
            >
              {i("sidebar.moveToGroup")}
            </Button>
          )}
          {selectedNoteIds.size > 0 && (
            <Button
              appearance="subtle"
              icon={<AddSquareMultipleRegular />}
              className={styles.settingsBtn}
              size="small"
              onClick={() => {
                const ids = Array.from(selectedNoteIds);
                onCreateGroup(
                  locale === "ko" ? "새 그룹" : "New group",
                  ids,
                );
                onSelectModeChange(false);
              }}
            >
              {i("sidebar.newGroupFromSelection")}
            </Button>
          )}
          {selectedNoteIds.size > 0 && (
            <Button
              appearance="subtle"
              icon={<DeleteRegular />}
              className={mergeClasses(styles.settingsBtn, styles.contextMenuDanger)}
              size="small"
              onClick={() => {
                const indices = docs
                  .map((d, idx) => selectedNoteIds.has(d.id) ? idx : -1)
                  .filter((idx) => idx >= 0);
                onDeleteNotes(indices);
                onSelectModeChange(false);
              }}
            >
              {i("sidebar.deleteSelected")}
            </Button>
          )}
          <Button
            appearance="subtle"
            icon={<DismissRegular />}
            className={styles.settingsBtn}
            size="small"
            onClick={() => onSelectModeChange(false)}
          >
            {i("sidebar.cancelSelect")}
          </Button>
        </div>
      )}

      {!selectMode && (
        <div className={styles.footer}>
          <Button
            appearance="subtle"
            icon={<SettingsRegular />}
            className={styles.settingsBtn}
            size="small"
            onClick={onOpenSettings}
          >
            {i("sidebar.settings")}
          </Button>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className={styles.contextMenu}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.type === "empty" && contextMenu.index === -1 && (
            <>
              <Button
                appearance="subtle"
                icon={<DocumentAddRegular />}
                className={styles.contextMenuItem}
                onClick={() => { onNewNote(); closeContextMenu(); }}
                size="small"
              >
                {i("sidebar.newNote")}
              </Button>
              <Button
                appearance="subtle"
                icon={<FolderOpenRegular />}
                className={styles.contextMenuItem}
                onClick={() => { onOpenFile(); closeContextMenu(); }}
                size="small"
              >
                {i("sidebar.open")}
              </Button>
              <Button
                appearance="subtle"
                icon={<WindowNewRegular />}
                className={styles.contextMenuItem}
                onClick={() => { openNewWindow(); closeContextMenu(); }}
                size="small"
              >
                {i("menu.newWindow")}
              </Button>
              <Button
                appearance="subtle"
                icon={<AddSquareMultipleRegular />}
                className={styles.contextMenuItem}
                onClick={() => { onCreatingGroupChange(true); closeContextMenu(); }}
                size="small"
              >
                {i("sidebar.newGroup")}
              </Button>
            </>
          )}

          {/* Select-mode move-to-group menu */}
          {contextMenu.type === "empty" && contextMenu.index === -2 && (
            <>
              {groups.map((g) => (
                <Button
                  key={g.id}
                  appearance="subtle"
                  icon={<SquareMultipleRegular />}
                  className={styles.contextMenuItem}
                  onClick={() => {
                    onMoveNotesToGroup(Array.from(selectedNoteIds), g.id);
                    onSelectModeChange(false);
                    closeContextMenu();
                  }}
                  size="small"
                >
                  {g.name}
                </Button>
              ))}
            </>
          )}

          {contextMenu.type === "note" && (
            <>
              <Button
                appearance="subtle"
                icon={<RenameRegular />}
                className={styles.contextMenuItem}
                onClick={() => { handleDoubleClick(contextMenu.index); closeContextMenu(); }}
                size="small"
              >
                {i("sidebar.rename")}
              </Button>
              <Button
                appearance="subtle"
                icon={<WindowNewRegular />}
                className={styles.contextMenuItem}
                onClick={() => { openNewWindow(docs[contextMenu.index]?.filePath); closeContextMenu(); }}
                size="small"
              >
                {i("sidebar.openInNewWindow")}
              </Button>
              <Button
                appearance="subtle"
                icon={<DocumentCopyRegular />}
                className={styles.contextMenuItem}
                onClick={() => { onDuplicateNote(contextMenu.index); closeContextMenu(); }}
                size="small"
              >
                {i("sidebar.duplicate")}
              </Button>
              <Button
                appearance="subtle"
                icon={<ArrowExportUpRegular />}
                className={styles.contextMenuItem}
                onClick={() => { onExportNote(contextMenu.index); closeContextMenu(); }}
                size="small"
              >
                {i("sidebar.export")}
              </Button>
              <Button
                appearance="subtle"
                icon={<CopyRegular />}
                className={styles.contextMenuItem}
                onClick={() => handleCopyContent(contextMenu.index)}
                size="small"
              >
                {i("sidebar.copyContent")}
              </Button>

              {/* Add to group submenu */}
              {groups.length > 0 && (
                <div
                  ref={submenuParentRef}
                  className={styles.submenuParent}
                  onMouseEnter={showSubmenu}
                  onMouseLeave={hideSubmenu}
                >
                  <Button
                    appearance="subtle"
                    icon={<SquareMultipleRegular />}
                    className={styles.contextMenuItem}
                    size="small"
                  >
                    {i("sidebar.addToGroup")}
                    <span className={styles.submenuArrow}>▶</span>
                  </Button>
                  {submenuOpen && submenuPos && (
                    <div
                      className={styles.submenu}
                      style={{ left: submenuPos.x, top: submenuPos.y }}
                      onMouseEnter={keepSubmenu}
                      onMouseLeave={hideSubmenu}
                    >
                      {groups.map((g) => (
                        <Button
                          key={g.id}
                          appearance="subtle"
                          className={styles.contextMenuItem}
                          onClick={() => {
                            const doc = docs[contextMenu.index];
                            if (doc) onAddNoteToGroup(doc.id, g.id);
                            closeContextMenu();
                          }}
                          size="small"
                        >
                          {g.name}
                        </Button>
                      ))}
                      <Button
                        appearance="subtle"
                        icon={<AddSquareMultipleRegular />}
                        className={styles.contextMenuItem}
                        onClick={() => {
                          const doc = docs[contextMenu.index];
                          if (doc) {
                            onCreateGroup(
                              locale === "ko" ? "새 그룹" : "New group",
                              [doc.id],
                            );
                          }
                          closeContextMenu();
                        }}
                        size="small"
                      >
                        {i("sidebar.newGroup")}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Add to group: direct option when no groups exist */}
              {groups.length === 0 && (
                <Button
                  appearance="subtle"
                  icon={<AddSquareMultipleRegular />}
                  className={styles.contextMenuItem}
                  onClick={() => {
                    const doc = docs[contextMenu.index];
                    if (doc) {
                      onCreateGroup(
                        locale === "ko" ? "새 그룹" : "New group",
                        [doc.id],
                      );
                    }
                    closeContextMenu();
                  }}
                  size="small"
                >
                  {i("sidebar.addToGroup")}
                </Button>
              )}

              {/* Remove from group */}
              {docs[contextMenu.index] && getGroupForNote(docs[contextMenu.index].id) && (
                <Button
                  appearance="subtle"
                  icon={<SubtractRegular />}
                  className={styles.contextMenuItem}
                  onClick={() => {
                    const doc = docs[contextMenu.index];
                    if (doc) onRemoveNoteFromGroup(doc.id);
                    closeContextMenu();
                  }}
                  size="small"
                >
                  {i("sidebar.removeFromGroup")}
                </Button>
              )}

              {docs[contextMenu.index]?.isExternal ? (
                <Button
                  appearance="subtle"
                  icon={<DismissRegular />}
                  className={mergeClasses(styles.contextMenuItem, styles.contextMenuDanger)}
                  onClick={() => { onCloseNote(contextMenu.index); closeContextMenu(); }}
                  size="small"
                >
                  {i("sidebar.close")}
                </Button>
              ) : (
                <Button
                  appearance="subtle"
                  icon={<DeleteRegular />}
                  className={mergeClasses(styles.contextMenuItem, styles.contextMenuDanger)}
                  onClick={() => { onDeleteNote(contextMenu.index); closeContextMenu(); }}
                  size="small"
                >
                  {i("sidebar.delete")}
                </Button>
              )}
            </>
          )}

          {contextMenu.type === "group" && contextMenu.groupId && (
            <>
              <Button
                appearance="subtle"
                icon={<RenameRegular />}
                className={styles.contextMenuItem}
                onClick={() => {
                  const group = groups.find((g) => g.id === contextMenu.groupId);
                  if (group) {
                    setEditingGroupId(group.id);
                    setEditingGroupValue(group.name);
                  }
                  closeContextMenu();
                }}
                size="small"
              >
                {i("sidebar.renameGroup")}
              </Button>
              <Button
                appearance="subtle"
                icon={<SubtractRegular />}
                className={styles.contextMenuItem}
                onClick={() => { onUngroupGroup(contextMenu.groupId!); closeContextMenu(); }}
                size="small"
              >
                {i("sidebar.ungroupGroup")}
              </Button>
              <Button
                appearance="subtle"
                icon={<DeleteRegular />}
                className={mergeClasses(styles.contextMenuItem, styles.contextMenuDanger)}
                onClick={() => {
                  const group = groups.find((g) => g.id === contextMenu.groupId);
                  if (group) {
                    // Delete notes in the group
                    const indices = group.noteIds
                      .map((nid) => docs.findIndex((d) => d.id === nid))
                      .filter((idx) => idx >= 0);
                    onDeleteNotes(indices);
                  }
                  onDeleteGroup(contextMenu.groupId!);
                  closeContextMenu();
                }}
                size="small"
              >
                {i("sidebar.deleteGroupAndNotes")}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
