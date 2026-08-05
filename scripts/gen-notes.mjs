// Generates a synthetic notes directory so sidebar/search/startup behavior can
// be measured at a library size no hand-made test folder reaches. Development
// aid only — nothing in the app or the release pipeline calls it.
//
//   node scripts/gen-notes.mjs --out "C:\\temp\\noten-bench" --count 2000
//
// Then point Settings → Notes folder at that directory. It writes the same
// layout the app reads: `<noteId>.md` bodies plus `.meta/<noteId>.json`
// sidecars (version 2), and a `.groups.json` when --groups is given.
//
// Refuses to write into a directory that already holds notes unless --force is
// passed, so it can never be aimed at a real library by accident.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

function parseArgs(argv) {
  const args = { out: "", count: 500, groups: 0, force: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--out") args.out = argv[++i] ?? "";
    else if (flag === "--count") args.count = Number.parseInt(argv[++i] ?? "", 10);
    else if (flag === "--groups") args.groups = Number.parseInt(argv[++i] ?? "", 10);
    else if (flag === "--force") args.force = true;
    else {
      console.error(`unknown argument: ${flag}`);
      process.exit(1);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.out) {
  console.error("usage: node scripts/gen-notes.mjs --out <dir> [--count N] [--groups N] [--force]");
  process.exit(1);
}
if (!Number.isInteger(args.count) || args.count < 1 || args.count > 100000) {
  console.error("--count must be an integer between 1 and 100000");
  process.exit(1);
}
if (!Number.isInteger(args.groups) || args.groups < 0 || args.groups > 500) {
  console.error("--groups must be an integer between 0 and 500");
  process.exit(1);
}

if (existsSync(args.out) && !args.force) {
  const existing = readdirSync(args.out).filter((name) => name.endsWith(".md"));
  if (existing.length > 0) {
    console.error(
      `${args.out} already contains ${existing.length} note bodies. Refusing to write without --force.`,
    );
    process.exit(1);
  }
}

const metaDir = join(args.out, ".meta");
mkdirSync(metaDir, { recursive: true });

const TOPICS = [
  "Release planning", "Design review", "Bug triage", "Reading notes",
  "Weekly retro", "회의록", "아이디어", "장보기 목록", "여행 준비", "학습 정리",
];

// Deterministic pseudo-random so two runs at the same count are comparable.
// Plain multiplication, not Math.imul: the product stays under 2^53 (exact),
// while imul's signed 32-bit wrap can go negative and push rand() above 1.
let seed = 0x2f6e2b1;
function rand() {
  seed = (seed * 48271) % 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick(list) {
  return list[Math.floor(rand() * list.length) % list.length];
}

function body(index, title, titles) {
  const paragraphs = 3 + Math.floor(rand() * 12);
  const lines = [`# ${title}`, ""];
  for (let p = 0; p < paragraphs; p++) {
    if (rand() < 0.15) {
      lines.push("```ts", `export const value${p} = ${index * 100 + p};`, "```", "");
      continue;
    }
    if (rand() < 0.2) {
      lines.push(`- [ ] item ${p}`, `- [x] done ${p}`, "");
      continue;
    }
    // Some notes link to a neighbour so wiki-link decoration work is exercised.
    const link = rand() < 0.25 && titles.length > 0 ? ` See [[${pick(titles)}]].` : "";
    lines.push(`Paragraph ${p} of note ${index}. Lorem ipsum dolor sit amet.${link}`, "");
  }
  return lines.join("\n");
}

const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const groupIds = Array.from({ length: args.groups }, () => randomUUID());
const titles = [];
const notes = [];

for (let i = 0; i < args.count; i++) {
  const id = randomUUID();
  const title = `${pick(TOPICS)} ${i + 1}`;
  titles.push(title);
  notes.push({ id, title, index: i });
}

for (const note of notes) {
  const createdAt = now - Math.floor(rand() * 365) * DAY;
  const updatedAt = createdAt + Math.floor(rand() * 30) * DAY;
  writeFileSync(join(args.out, `${note.id}.md`), body(note.index, note.title, titles), "utf8");
  writeFileSync(
    join(metaDir, `${note.id}.json`),
    JSON.stringify(
      {
        version: 2,
        id: note.id,
        fileName: note.title,
        customName: true,
        createdAt,
        updatedAt: Math.min(updatedAt, now),
        pinned: note.index % 97 === 0,
        groupId: groupIds.length > 0 ? groupIds[note.index % groupIds.length] : null,
        groupUpdatedAt: createdAt,
        trashedAt: null,
      },
      null,
      2,
    ),
    "utf8",
  );
}

if (groupIds.length > 0) {
  writeFileSync(
    join(args.out, ".groups.json"),
    JSON.stringify(
      {
        version: 1,
        // Keyed by group id — the on-disk shape groupsIO.ts reads, not an array.
        groups: Object.fromEntries(groupIds.map((id, i) => [
          id,
          {
            id,
            name: `Group ${i + 1}`,
            createdAt: now - (groupIds.length - i) * DAY,
            updatedAt: now,
            orderKey: String(i).padStart(6, "0"),
            orderUpdatedAt: now,
            // Required by groupsIO's isValidEntry — `undefined` fails its
            // `null || number` check and the whole entry is silently dropped,
            // leaving every generated note ungrouped.
            deletedAt: null,
          },
        ])),
      },
      null,
      2,
    ),
    "utf8",
  );
}

console.log(`wrote ${args.count} notes and ${groupIds.length} groups to ${args.out}`);
