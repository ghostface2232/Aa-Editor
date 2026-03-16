import { useState, useEffect, useRef } from "react";
import { appDataDir } from "@tauri-apps/api/path";
import { mkdir, readTextFile, writeTextFile, readDir } from "@tauri-apps/plugin-fs";

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
  await mkdir(dir, { recursive: true }).catch(() => {});
  return dir;
}

async function readManifest(dir: string): Promise<Manifest | null> {
  try {
    const raw = await readTextFile(`${dir}/manifest.json`);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readFileContent(path: string): Promise<string> {
  try {
    return await readTextFile(path);
  } catch {
    return "";
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
      id, filePath, fileName, isExternal, createdAt, updatedAt,
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
          // 병렬로 모든 노트 파일 로드
          const loaded = await Promise.all(
            manifest.notes.map(async (entry) => {
              const content = await readFileContent(entry.filePath);
              return { ...entry, isDirty: false, content } as NoteDoc;
            }),
          );

          setDocs(loaded);
          const idx = manifest.activeNoteId
            ? loaded.findIndex((d) => d.id === manifest.activeNoteId)
            : 0;
          setActiveIndex(idx >= 0 ? idx : 0);
        } else {
          // 매니페스트 없으면 notes 디렉토리 스캔
          let foundNotes: NoteDoc[] = [];
          try {
            const entries = await readDir(dir);
            const mdEntries = entries.filter((e) => e.name?.endsWith(".md"));
            foundNotes = await Promise.all(
              mdEntries.map(async (entry) => {
                const id = entry.name!.replace(/\.md$/, "");
                const fp = `${dir}/${entry.name}`;
                const content = await readFileContent(fp);
                return {
                  id, filePath: fp,
                  fileName: deriveTitle(content) || "Untitled",
                  isExternal: false, isDirty: false, content,
                  createdAt: Date.now(), updatedAt: Date.now(),
                } as NoteDoc;
              }),
            );
          } catch {}

          if (foundNotes.length === 0) {
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
        console.warn("Notes loader failed (browser mode?):", err);
        setDocs([{
          id: "local", filePath: "", fileName: "Untitled",
          isExternal: false, isDirty: false, content: "",
          createdAt: Date.now(), updatedAt: Date.now(),
        }]);
        setActiveIndex(0);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  return { docs, setDocs, activeIndex, setActiveIndex, isLoading };
}

/** 컨텐츠 첫 번째 줄에서 제목 추출 */
export function deriveTitle(content: string): string {
  if (!content) return "";
  const firstLine = content.trimStart().split("\n")[0];
  const heading = firstLine.replace(/^#+\s*/, "").trim();
  return heading.slice(0, 60) || "";
}
