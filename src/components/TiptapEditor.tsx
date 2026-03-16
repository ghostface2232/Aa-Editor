import {
  useEffect,
  useImperativeHandle,
  forwardRef,
  useRef,
  useCallback,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { Slice } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { common, createLowlight } from "lowlight";
import SlashCommands from "../extensions/SlashCommands";
import ImageDrop from "../extensions/ImageDrop";
import { t } from "../i18n";
import type { Locale } from "../hooks/useSettings";
import "../styles/tiptap-editor.css";

declare module "@tiptap/core" {
  interface Storage {
    readonlyGuard: { readonly: boolean };
    slashCommands: { locale: string };
  }
}

/**
 * 마크다운 붙여넣기: plain text 붙여넣기 시 마크다운 구문이 감지되면
 * 마크다운으로 파싱하여 ProseMirror Slice로 삽입한다.
 */
const MD_PATTERN = /^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|^>\s|^```|^\|.+\||\[.+\]\(.+\)/m;

const MarkdownPaste = Extension.create({
  name: "markdownPaste",
  priority: 100,

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("markdownPaste"),
        props: {
          handlePaste(_view, event, _slice) {
            // HTML 콘텐츠가 있으면 기본 처리
            if (event.clipboardData?.getData("text/html")) return false;

            const text = event.clipboardData?.getData("text/plain");
            if (!text || !MD_PATTERN.test(text)) return false;

            // 마크다운을 파싱하여 JSON → ProseMirror 노드로 변환
            if (!editor.markdown) return false;
            const parsed = editor.markdown.parse(text);
            if (!parsed) return false;

            const doc = editor.schema.nodeFromJSON(parsed);
            event.preventDefault();

            const { tr } = _view.state;
            tr.replaceSelection(new Slice(doc.content, 0, 0));
            _view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});

/**
 * 테이블 노드 선택 가드:
 * 커서가 테이블 바로 앞/뒤에서 방향키로 이동할 때, 테이블 안으로 바로 진입하지 않고
 * 먼저 테이블 전체를 NodeSelection으로 선택한다.
 * 이미 테이블이 NodeSelection된 상태에서 방향키를 누르면 테이블 안으로 진입한다.
 */
const TableNodeSelect = Extension.create({
  name: "tableNodeSelect",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("tableNodeSelect"),
        props: {
          handleKeyDown(view, event) {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp" &&
                event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
              return false;
            }

            const { state } = view;
            const { selection, doc } = state;

            // 이미 NodeSelection이면 통과 (테이블 안으로 진입)
            if (selection instanceof NodeSelection) return false;

            // TextSelection일 때만 처리
            if (!(selection instanceof TextSelection) || !selection.empty) return false;

            const pos = selection.$from;
            const forward = event.key === "ArrowDown" || event.key === "ArrowRight";

            if (forward) {
              // 커서 뒤쪽에 테이블이 있는지 확인
              const after = pos.after();
              if (after < doc.content.size) {
                const nodeAfter = doc.resolve(after).nodeAfter;
                if (nodeAfter?.type.name === "table") {
                  event.preventDefault();
                  const tr = state.tr.setSelection(NodeSelection.create(doc, after));
                  view.dispatch(tr);
                  return true;
                }
              }
            } else {
              // 커서 앞쪽에 테이블이 있는지 확인
              const before = pos.before();
              if (before > 0) {
                const nodeBefore = doc.resolve(before).nodeBefore;
                if (nodeBefore?.type.name === "table") {
                  event.preventDefault();
                  const tablePos = before - nodeBefore.nodeSize;
                  const tr = state.tr.setSelection(NodeSelection.create(doc, tablePos));
                  view.dispatch(tr);
                  return true;
                }
              }
            }

            return false;
          },
        },
      }),
    ];
  },
});

/**
 * 읽기 모드 가드:
 * - editable을 항상 true로 유지 → 텍스트 선택/복사가 가능
 * - readonly 상태에서 문서 변경 트랜잭션을 차단 → 편집 불가
 * - readonly 상태에서 키 입력(타이핑, 백스페이스 등)도 차단
 */
const ReadonlyGuard = Extension.create({
  name: "readonlyGuard",

  addStorage() {
    return { readonly: false };
  },

  addProseMirrorPlugins() {
    const storage = this.storage as { readonly: boolean };
    return [
      new Plugin({
        key: new PluginKey("readonlyGuard"),
        filterTransaction(tr) {
          if (storage.readonly && tr.docChanged) {
            return false;
          }
          return true;
        },
        props: {
          handleKeyDown(_view, _event) {
            // readonly일 때 Ctrl+C, Ctrl+A 등 복사/선택 단축키는 허용
            if (!storage.readonly) return false;
            const e = _event as KeyboardEvent;
            if (e.ctrlKey || e.metaKey) return false;
            // 화살표, Home, End, PageUp, PageDown은 허용 (탐색)
            if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End" ||
                e.key === "PageUp" || e.key === "PageDown") return false;
            // 그 외 키 입력은 차단
            return true;
          },
          handleDOMEvents: {
            // readonly에서 붙여넣기, 드롭, 잘라내기 차단
            paste(_view, event) {
              if (storage.readonly) { event.preventDefault(); return true; }
              return false;
            },
            drop(_view, event) {
              if (storage.readonly) { event.preventDefault(); return true; }
              return false;
            },
            cut(_view, event) {
              if (storage.readonly) { event.preventDefault(); return true; }
              return false;
            },
          },
        },
      }),
    ];
  },
});

const lowlight = createLowlight(common);

export interface TiptapEditorHandle {
  getMarkdown: () => string;
  setContent: (markdown: string) => void;
  setEditable: (editable: boolean) => void;
  getEditor: () => ReturnType<typeof useEditor> | null;
}

interface TiptapEditorProps {
  initialMarkdown: string;
  editable: boolean;
  isDarkMode: boolean;
  locale: Locale;
  spellcheck: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onReady?: () => void;
}

export const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(
  function TiptapEditor({ initialMarkdown, editable, isDarkMode, locale, spellcheck, onDirtyChange, onReady }, ref) {
    const dirtyRef = useRef(false);

    const handleUpdate = useCallback(() => {
      if (!dirtyRef.current) {
        dirtyRef.current = true;
        onDirtyChange(true);
      }
    }, [onDirtyChange]);

    const editor = useEditor({
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        Markdown,
        CodeBlockLowlight.extend({
          renderHTML({ node, HTMLAttributes }) {
            return [
              "pre",
              {
                ...HTMLAttributes,
                "data-language": node.attrs.language || "",
              },
              ["code", { class: node.attrs.language ? `language-${node.attrs.language}` : null }, 0],
            ];
          },
        }).configure({ lowlight }),
        Image,
        Placeholder.configure({ placeholder: t("placeholder", locale) }),
        Typography,
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        Underline,
        Table,
        TableRow,
        TableCell,
        TableHeader,
        TableNodeSelect,
        MarkdownPaste,
        ReadonlyGuard,
        SlashCommands,
        ImageDrop,
      ],
      content: initialMarkdown,
      contentType: "markdown",
      editable: true,
      immediatelyRender: true,
      onUpdate: handleUpdate,
    });

    // editor 준비 시 onReady 호출
    useEffect(() => {
      if (editor && onReady) onReady();
    }, [editor, onReady]);

    // editable prop → ReadonlyGuard storage 동기화
    useEffect(() => {
      if (editor) {
        editor.storage.readonlyGuard.readonly = !editable;
        if (!editable) dirtyRef.current = false;
      }
    }, [editor, editable]);

    // locale → SlashCommands storage 동기화
    useEffect(() => {
      if (editor && editor.storage.slashCommands) {
        editor.storage.slashCommands.locale = locale;
      }
    }, [editor, locale]);

    // spellcheck 속성 동기화
    useEffect(() => {
      const el = editor?.view.dom;
      if (el) {
        el.setAttribute("spellcheck", String(spellcheck));
      }
    }, [editor, spellcheck]);

    useImperativeHandle(
      ref,
      () => ({
        getMarkdown: () => {
          if (!editor) return "";
          return editor.getMarkdown();
        },
        setContent: (markdown: string) => {
          if (!editor) return;
          // ReadonlyGuard를 임시 해제하여 setContent가 차단되지 않게
          const wasReadonly = editor.storage.readonlyGuard.readonly;
          editor.storage.readonlyGuard.readonly = false;
          editor.commands.setContent(markdown, {
            emitUpdate: false,
            contentType: "markdown",
          });
          editor.storage.readonlyGuard.readonly = wasReadonly;
          dirtyRef.current = false;
        },
        setEditable: (value: boolean) => {
          if (!editor) return;
          editor.storage.readonlyGuard.readonly = !value;
          if (!value) {
            dirtyRef.current = false;
          }
        },
        getEditor: () => editor,
      }),
      [editor],
    );

    return (
      <div
        className={editable ? "tiptap-editable" : "tiptap-readonly"}
        data-theme={isDarkMode ? "dark" : "light"}
      >
        <EditorContent editor={editor} />
      </div>
    );
  },
);
