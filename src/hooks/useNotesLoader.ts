import { useState, useEffect, useCallback, useRef } from "react";
import { appDataDir } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, writeTextFile, readDir } from "@tauri-apps/plugin-fs";

export interface NoteDoc {
  id: string;
  filePath: string;
  fileName: string;
  isExternal: boolean;
  isDirty: boolean;
  content: string;
  createdAt: number;
  updatedAt: number;
}

interface Manifest {
  version: 1;
  notes: Omit<NoteDoc, "isDirty" | "content">[];
  activeNoteId: string | null;
}

let _notesDir: string | null = null;

export async function getNotesDir(): Promise<string> {
  if (_notesDir) return _notesDir;
  const base = await appDataDir();
  _notesDir = `${base}notes`;
  return _notesDir;
}

async function ensureNotesDir(): Promise<string> {
  const dir = await getNotesDir();
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }
  return dir;
}

async function readManifest(dir: string): Promise<Manifest | null> {
  const path = `${dir}/manifest.json`;
  try {
    if (!(await exists(path))) return null;
    const raw = await readTextFile(path);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveManifest(
  docs: NoteDoc[],
  activeId: string | null,
): Promise<void> {
  const dir = await getNotesDir();
  const manifest: Manifest = {
    version: 1,
    notes: docs.map(({ id, filePath, fileName, isExternal, createdAt, updatedAt }) => ({
      id,
      filePath,
      fileName,
      isExternal,
      createdAt,
      updatedAt,
    })),
    activeNoteId: activeId,
  };
  await writeTextFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2));
}

export function useNotesLoader() {
  const [docs, setDocs] = useState<NoteDoc[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    (async () => {
      try {
        const dir = await ensureNotesDir();
        const manifest = await readManifest(dir);

        if (manifest && manifest.notes.length > 0) {
          // Manifest에서 노트 목록 복원
          const loaded: NoteDoc[] = [];
          for (const entry of manifest.notes) {
            let content = "";
            try {
              if (await exists(entry.filePath)) {
                content = await readTextFile(entry.filePath);
              }
            } catch { /* 파일 없으면 빈 내용 */ }
            loaded.push({ ...entry, isDirty: false, content });
          }

          setDocs(loaded);
          const idx = manifest.activeNoteId
            ? loaded.findIndex((d) => d.id === manifest.activeNoteId)
            : 0;
          setActiveIndex(idx >= 0 ? idx : 0);
        } else {
          // 매니페스트 없으면 notes 디렉토리 스캔 시도
          let foundNotes: NoteDoc[] = [];
          try {
            const entries = await readDir(dir);
            for (const entry of entries) {
              if (entry.name && entry.name.endsWith(".md")) {
                const id = entry.name.replace(/\.md$/, "");
                const fp = `${dir}/${entry.name}`;
                let content = "";
                try { content = await readTextFile(fp); } catch {}
                foundNotes.push({
                  id,
                  filePath: fp,
                  fileName: deriveTitle(content) || "Untitled",
                  isExternal: false,
                  isDirty: false,
                  content,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                });
              }
            }
          } catch {}

          if (foundNotes.length === 0) {
            // 첫 실행: 빈 메모 하나 생성
            const id = crypto.randomUUID();
            const fp = `${dir}/${id}.md`;
            await writeTextFile(fp, "");
            foundNotes = [{
              id, filePath: fp, fileName: "Untitled",
              isExternal: false, isDirty: false, content: "",
              createdAt: Date.now(), updatedAt: Date.now(),
            }];
          }

          setDocs(foundNotes);
          setActiveIndex(0);
          await saveManifest(foundNotes, foundNotes[0]?.id ?? null);
        }
      } catch (err) {
        // Tauri API 사용 불가 (브라우저 환경) — 기본 빈 문서
        console.warn("Notes loader failed (browser mode?):", err);
        setDocs([{
          id: "local",
          filePath: "",
          fileName: "Untitled",
          isExternal: false,
          isDirty: false,
          content: "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }]);
        setActiveIndex(0);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const persistManifest = useCallback(() => {
    if (docs.length > 0) {
      const activeId = docs[activeIndex]?.id ?? null;
      saveManifest(docs, activeId).catch(() => {});
    }
  }, [docs, activeIndex]);

  return { docs, setDocs, activeIndex, setActiveIndex, isLoading, persistManifest };
}

/** 컨텐츠 첫 번째 줄에서 제목 추출 */
export function deriveTitle(content: string): string {
  if (!content) return "";
  const firstLine = content.trimStart().split("\n")[0];
  const heading = firstLine.replace(/^#+\s*/, "").trim();
  return heading.slice(0, 60) || "";
}
