import type { NoteColorId } from "./noteColors";

export interface NoteDoc {
  id: string;
  filePath: string;
  fileName: string;
  isDirty: boolean;
  content: string;
  createdAt: number;
  updatedAt: number;
  customName?: boolean;
  pinned?: boolean;
  color?: NoteColorId;
}

export interface NoteGroup {
  id: string;
  name: string;
  noteIds: string[];
  collapsed: boolean;
  createdAt: number;
  orderKey?: string;
  orderUpdatedAt?: number;
  updatedAt?: number;
}

export interface TrashedNote {
  id: string;
  fileName: string;
  originalFilePath: string;
  trashFilePath: string;
  trashedAt: number;
  groupId: string | null;
  createdAt: number;
  updatedAt: number;
  customName?: boolean;
  pinned?: boolean;
  color?: NoteColorId;
}
