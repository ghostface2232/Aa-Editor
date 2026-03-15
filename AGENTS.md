# Markdown Studio

Windows용 네이티브 마크다운 에디터. Tauri v2 + React + TypeScript.

## 아키텍처

마크다운 문자열이 유일한 원본(Single Source of Truth).
읽기와 편집이 같은 Tiptap 인스턴스 위에서 동작하며, editable 플래그만 토글.
DOM이 교체되지 않으므로 모드 전환 시 스크롤 위치가 완벽히 보존됨.

- 읽기 모드: Tiptap editable:false (편집 불가, 텍스트 선택/복사 가능)
- 편집 > Rich Text: Tiptap editable:true (WYSIWYG)
- 편집 > Markdown: CodeMirror 6 + @codemirror/lang-markdown (소스 편집)

에디터 마운트 정책: 읽기/Rich Text는 동일 Tiptap 인스턴스(항상 마운트).
CodeMirror는 Markdown 편집 진입 시에만 마운트, 이탈 시 언마운트.
이유: 읽기↔편집 전환에서 DOM 보존이 핵심 UX이며,
상태 동기화 로직을 단순하게 유지하기 위함.

## @tiptap/markdown API (공식 3.20+)

주의: 커뮤니티 패키지(tiptap-markdown)와 API가 다름.
반드시 아래 공식 API를 사용할 것:

- 직렬화: editor.getMarkdown()
- 역직렬화: editor.commands.setContent(value, { contentType: 'markdown' })
- 초기 콘텐츠: new Editor({ content: '...', contentType: 'markdown' })
- MarkdownManager: editor.markdown.parse(), editor.markdown.serialize()

❌ 사용하지 않는 API: editor.storage.markdown.getMarkdown() (구 커뮤니티 패키지)

## 상태 설계

- markdown: string — 유일한 원본
- isEditing: boolean — 읽기(false) / 편집(true)
- editorMode: 'richtext' | 'markdown' — 편집 내 에디터 종류
- filePath: string | null
- isDirty: boolean — 미저장 변경 여부
- tiptapDirty: boolean — Tiptap에서 실제 편집 발생 여부

## 모드 전환 규칙

- 읽기 ↔ Rich Text: Tiptap의 editor.setEditable(boolean) 호출. DOM 교체 없음.
- Rich Text → CodeMirror: tiptapDirty가 true이면 editor.getMarkdown()으로 원문 갱신 후 CodeMirror에 전달.
- CodeMirror → Rich Text/읽기: CodeMirror의 현재 텍스트로 원문 갱신 후 editor.commands.setContent(value, { contentType: 'markdown' }).

## 시각적 일관성 규칙

색상, 아이콘, 간격의 일관성은 세 계층에서 각각 다르게 관리된다.

앱 셸(타이틀바, 툴바, 상태바, 다이얼로그, 버튼 등):
Fluent UI v9 컴포넌트를 그대로 사용한다. FluentProvider가 테마를 관리하므로 자동 통일.

에디터/뷰 콘텐츠 영역(.ProseMirror, .cm-editor):
Fluent UI 컴포넌트가 아니라 독자적인 DOM이므로, Fluent UI가 주입하는 CSS 변수를 직접 참조하여 색상을 동기화한다.
src/styles/theme.css에 다음과 같이 매핑:
- --editor-color-text: var(--colorNeutralForeground1)
- --editor-color-bg: var(--colorNeutralBackground1)
- --editor-color-accent: var(--colorBrandForeground1)
- 기타 색상도 동일 패턴
이렇게 하면 FluentProvider의 theme이 바뀔 때 세 뷰의 색상도 자동 전환된다.
레이아웃(폰트, 간격, 최대 너비 등)은 독립적인 CSS 변수로 정의.

플로팅 UI(BubbleMenu, SlashCommand 드롭다운):
내부에 Fluent UI 컴포넌트(Button, Toolbar 등)를 직접 배치하거나,
동일한 Fluent CSS 변수를 참조하여 스타일링한다.

아이콘:
앱 전역에서 @fluentui/react-icons만 사용한다.
다른 아이콘 라이브러리(lucide, heroicons 등)를 섞지 않는다.
선 두께, 스타일, 시각적 무게감이 달라져 어색해지기 때문이다.

## 폰트 시스템

폰트 종류는 고정이며 사용자가 변경할 수 없다.
다음 세 종류의 슬롯만 사용한다:

- --editor-font-family-serif: (Serif 서체 - 개발 중 결정)
- --editor-font-family-sans: (Sans-Serif 서체 - 개발 중 결정)
- --editor-font-family-mono: (Monospace 서체 - 개발 중 결정)

에디터/읽기 뷰의 본문은 Sans-Serif를, 코드블럭은 Monospace를 사용한다.
Serif는 필요 시 특정 요소에 적용.

## Tiptap v3 import 규칙

v2와 패키지 구조가 다르다. 반드시 아래 경로를 따를 것:
- BubbleMenu, FloatingMenu: import from '@tiptap/react/menus' (NOT '@tiptap/react')
- Table: import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
- List: StarterKit에 포함. 개별 사용 시 import from '@tiptap/extension-list'
- Placeholder, History 등: import from '@tiptap/extensions'
- @floating-ui/dom 필수 (tippy.js 사용하지 않음)
- lowlight: import { common, createLowlight } from 'lowlight'; const lowlight = createLowlight(common)
- Markdown: import { Markdown } from '@tiptap/markdown'

## 기술 스택

- Tauri v2, React (create-tauri-app이 설치하는 버전), TypeScript, Vite
- @fluentui/react-components, @fluentui/react-icons
- @tiptap/react, @tiptap/markdown, @tiptap/extension-code-block-lowlight
- @uiw/react-codemirror, @codemirror/lang-markdown, @codemirror/language-data
- @tauri-apps/plugin-dialog, @tauri-apps/plugin-fs

## 코드 스타일

- 컴포넌트 파일명: PascalCase (RichTextEditor.tsx)
- 훅 파일명: camelCase (useMarkdownState.ts)
- CSS: src/styles/ 에 모듈별 분리
- 공유 CSS 변수: src/styles/theme.css