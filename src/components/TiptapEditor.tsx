import {
  useEffect,
  useImperativeHandle,
  forwardRef,
  useRef,
  useCallback,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
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
import "../styles/tiptap-editor.css";

declare module "@tiptap/core" {
  interface Storage {
    readonlyGuard: { readonly: boolean };
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
  onDirtyChange: (dirty: boolean) => void;
}

export const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(
  function TiptapEditor({ initialMarkdown, editable, isDarkMode, onDirtyChange }, ref) {
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
        Placeholder.configure({ placeholder: "여기에 글을 작성하세요..." }),
        Typography,
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        Underline,
        Table,
        TableRow,
        TableCell,
        TableHeader,
        MarkdownPaste,
        ReadonlyGuard,
      ],
      content: initialMarkdown,
      contentType: "markdown",
      editable: true,
      immediatelyRender: true,
      onUpdate: handleUpdate,
    });

    // editable prop → ReadonlyGuard storage 동기화
    useEffect(() => {
      if (editor) {
        editor.storage.readonlyGuard.readonly = !editable;
        if (!editable) {
          dirtyRef.current = false;
        }
      }
    }, [editor, editable]);

    useImperativeHandle(
      ref,
      () => ({
        getMarkdown: () => {
          if (!editor) return "";
          return editor.getMarkdown();
        },
        setContent: (markdown: string) => {
          if (!editor) return;
          editor.commands.setContent(markdown, {
            emitUpdate: false,
            contentType: "markdown",
          });
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
