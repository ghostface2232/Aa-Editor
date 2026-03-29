import { mkdir, readDir, copyFile, readTextFile, writeTextFile, exists } from "@tauri-apps/plugin-fs";

interface ManifestNote {
  id: string;
  filePath: string;
  fileName: string;
  createdAt: number;
  updatedAt: number;
}

interface Manifest {
  version: 1;
  notes: ManifestNote[];
  activeNoteId: string | null;
  groups?: unknown[];
}

export interface MigrationResult {
  success: boolean;
  error?: string;
}

function normalizeSep(dir: string): string {
  return dir.endsWith("/") || dir.endsWith("\\") ? dir : `${dir}/`;
}

function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? "";
}

function rewriteFilePaths(manifest: Manifest, toDir: string): Manifest {
  const base = normalizeSep(toDir);
  return {
    ...manifest,
    notes: manifest.notes.map((n) => ({
      ...n,
      filePath: `${base}${getFileName(n.filePath)}`,
    })),
  };
}

async function readManifestFile(dir: string): Promise<Manifest | null> {
  try {
    const path = `${normalizeSep(dir)}manifest.json`;
    const raw = await readTextFile(path);
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

function mergeManifests(source: Manifest, dest: Manifest, toDir: string): Manifest {
  const base = normalizeSep(toDir);

  // Merge notes: destination first, source overwrites by ID
  const noteMap = new Map<string, ManifestNote>();
  for (const n of dest.notes) {
    noteMap.set(n.id, { ...n, filePath: `${base}${getFileName(n.filePath)}` });
  }
  for (const n of source.notes) {
    noteMap.set(n.id, { ...n, filePath: `${base}${getFileName(n.filePath)}` });
  }

  // Merge groups: destination first, source overwrites by ID
  const groupMap = new Map<string, unknown>();
  for (const g of dest.groups ?? []) {
    const gObj = g as { id: string };
    groupMap.set(gObj.id, g);
  }
  for (const g of source.groups ?? []) {
    const gObj = g as { id: string };
    groupMap.set(gObj.id, g);
  }

  return {
    version: 1,
    notes: Array.from(noteMap.values()),
    activeNoteId: source.activeNoteId,
    groups: groupMap.size > 0 ? Array.from(groupMap.values()) : undefined,
  };
}

export async function migrateNotesDir(
  fromDir: string,
  toDir: string,
  mergeStrategy: "merge" | "overwrite",
): Promise<MigrationResult> {
  // Same directory — nothing to do
  const from = normalizeSep(fromDir).replace(/[\\/]+$/, "");
  const to = normalizeSep(toDir).replace(/[\\/]+$/, "");
  if (from === to) return { success: true };

  try {
    await mkdir(toDir, { recursive: true });

    // Copy .md files
    const entries = await readDir(fromDir);
    const mdFiles = entries.filter((e) => e.name?.endsWith(".md"));
    for (const entry of mdFiles) {
      const srcPath = `${normalizeSep(fromDir)}${entry.name}`;
      const destPath = `${normalizeSep(toDir)}${entry.name}`;
      await copyFile(srcPath, destPath);
    }

    // Handle manifest
    const sourceManifest = await readManifestFile(fromDir);
    if (!sourceManifest) {
      return { success: true };
    }

    if (mergeStrategy === "merge") {
      const destManifest = await readManifestFile(toDir);
      if (destManifest) {
        const merged = mergeManifests(sourceManifest, destManifest, toDir);
        await writeTextFile(
          `${normalizeSep(toDir)}manifest.json`,
          JSON.stringify(merged, null, 2),
        );
      } else {
        const rewritten = rewriteFilePaths(sourceManifest, toDir);
        await writeTextFile(
          `${normalizeSep(toDir)}manifest.json`,
          JSON.stringify(rewritten, null, 2),
        );
      }
    } else {
      const rewritten = rewriteFilePaths(sourceManifest, toDir);
      await writeTextFile(
        `${normalizeSep(toDir)}manifest.json`,
        JSON.stringify(rewritten, null, 2),
      );
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function hasManifest(dir: string): Promise<boolean> {
  try {
    return await exists(`${normalizeSep(dir)}manifest.json`);
  } catch {
    return false;
  }
}
