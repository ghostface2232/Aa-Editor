import { useState, useEffect, useCallback, useRef } from "react";
import {
  FluentProvider,
  webLightTheme,
  webDarkTheme,
  makeStyles,
  mergeClasses,
  tokens,
  Button,
} from "@fluentui/react-components";
import { PanelLeftRegular, PanelLeftFilled } from "@fluentui/react-icons";
import { getCurrentWindow, Effect } from "@tauri-apps/api/window";
import { useMarkdownState } from "./hooks/useMarkdownState";
import {
  TiptapEditor,
  type TiptapEditorHandle,
} from "./components/TiptapEditor";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { MarkdownEditor } from "./components/MarkdownEditor";
import { EditorToolbar } from "./components/EditorToolbar";
import { StatusBar } from "./components/StatusBar";
import "./App.css";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    color: tokens.colorNeutralForeground1,
    position: "relative",
  },
  micaOverlay: {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    zIndex: 1,
  },
  body: {
    flex: "1",
    display: "flex",
    position: "relative",
    overflow: "hidden",
    zIndex: 2,
  },

  sidebarSlot: {
    width: 0,
    flexShrink: 0,
    overflow: "hidden",
    transitionProperty: "width",
    transitionDuration: "0.3s",
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
  },
  sidebarSlotOpen: {
    width: "var(--shell-sidebar-width)",
  },
  sidebarToggle: {
    position: "absolute",
    top: "12px",
    left: "12px",
    zIndex: 10,
    display: "inline-flex",
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: "8px",
    padding: "3px",
  },
  sidebarToggleBtn: {
    borderRadius: "6px",
    border: "none",
    minWidth: "auto",
    height: "28px",
    width: "28px",
    padding: "0",
  },
  floatingCard: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flex: "1",
    minWidth: 0,
    backgroundColor: tokens.colorNeutralBackground1,
    borderTopLeftRadius: "8px",
    overflow: "hidden",
    boxShadow: "-1px 0 3px rgba(0,0,0,0.08)",
    marginTop: "var(--shell-card-gap)",
  },
  content: {
    flex: "1",
    overflow: "auto",
    position: "relative",
  },
  tiptapVisible: {
    opacity: 1,
    transitionProperty: "opacity",
    transitionDuration: "0.15s",
    transitionTimingFunction: "ease",
    height: "100%",
  },
  tiptapHidden: {
    opacity: 0,
    position: "absolute",
    pointerEvents: "none",
    height: 0,
    overflow: "hidden",
  },
  codemirrorWrapper: {
    opacity: 1,
    transitionProperty: "opacity",
    transitionDuration: "0.15s",
    transitionTimingFunction: "ease",
    height: "100%",
  },
});

function App() {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const state = useMarkdownState();
  const styles = useStyles();
  const tiptapRef = useRef<TiptapEditorHandle>(null);

  // OS Mica 효과
  useEffect(() => {
    getCurrentWindow()
      .setEffects({ effects: [Effect.Mica] })
      .catch(() => {
        document.documentElement.style.setProperty(
          "--shell-fallback-bg",
          isDarkMode ? "#2a2a28" : "#f0ece4",
        );
      });
  }, [isDarkMode]);

  // TiptapEditor ref를 editorRef에 연결
  useEffect(() => {
    if (tiptapRef.current) {
      const editor = tiptapRef.current.getEditor();
      state.editorRef.current = editor ?? null;
    }
  });

  // 단축키
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "e") {
        e.preventDefault();
        state.toggleEditing();
      }
      if (e.ctrlKey && e.key === "/" && state.isEditing) {
        e.preventDefault();
        state.switchEditorMode();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state.toggleEditing, state.switchEditorMode, state.isEditing]);

  const handleTiptapDirty = useCallback(
    (dirty: boolean) => {
      state.setTiptapDirty(dirty);
    },
    [state.setTiptapDirty],
  );

  const handleCodemirrorChange = useCallback(
    (value: string) => {
      state.updateMarkdown(value);
    },
    [state.updateMarkdown],
  );

  const showCodeMirror = state.isEditing && state.editorMode === "markdown";

  return (
    <FluentProvider
      theme={isDarkMode ? webDarkTheme : webLightTheme}
      style={{ background: "transparent" }}
      data-theme={isDarkMode ? "dark" : "light"}
    >
      <div className={styles.root}>
        {/* 다크모드 오버레이 */}
        {isDarkMode && (
          <div
            className={styles.micaOverlay}
            style={{ background: "rgba(0, 0, 0, 0.78)" }}
          />
        )}

        <TitleBar
          filePath={state.filePath}
          isDirty={state.isDirty}
          isEditing={state.isEditing}
          isDarkMode={isDarkMode}
          onToggleDarkMode={() => setIsDarkMode((d) => !d)}
          onToggleEditing={state.toggleEditing}
        />

        <div className={styles.body}>
          <div className={styles.sidebarToggle}>
            <Button
              appearance="subtle"
              icon={sidebarOpen ? <PanelLeftFilled /> : <PanelLeftRegular />}
              className={styles.sidebarToggleBtn}
              onClick={() => setSidebarOpen((o) => !o)}
            />
          </div>

          <div
            className={mergeClasses(
              styles.sidebarSlot,
              sidebarOpen && styles.sidebarSlotOpen,
            )}
          >
            <Sidebar />
          </div>

          <div className={styles.floatingCard}>
            <div className={styles.content}>
              {state.isEditing && (
                <EditorToolbar
                  editorMode={state.editorMode}
                  onSwitchMode={state.switchEditorMode}
                />
              )}

              {/* Tiptap: 항상 마운트 */}
              <div
                className={
                  showCodeMirror ? styles.tiptapHidden : styles.tiptapVisible
                }
              >
                <TiptapEditor
                  ref={tiptapRef}
                  initialMarkdown={state.markdown}
                  editable={state.isEditing && state.editorMode === "richtext"}
                  isDarkMode={isDarkMode}
                  onDirtyChange={handleTiptapDirty}
                />
              </div>

              {/* CodeMirror: markdown 편집 모드에서만 마운트 */}
              {showCodeMirror && (
                <div className={styles.codemirrorWrapper}>
                  <MarkdownEditor
                    value={state.markdown}
                    onChange={handleCodemirrorChange}
                    isDarkMode={isDarkMode}
                  />
                </div>
              )}
            </div>

            <StatusBar
              markdown={state.markdown}
              isEditing={state.isEditing}
              editorMode={state.editorMode}
            />
          </div>
        </div>
      </div>
    </FluentProvider>
  );
}

export default App;
