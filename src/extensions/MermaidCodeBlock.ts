import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import type { NodeViewRendererProps } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { NodeView, ViewMutationRecord } from "@tiptap/pm/view";

const MERMAID_LANGUAGE = "mermaid";
const MERMAID_RENDER_DELAY_MS = 120;
const MERMAID_FONT_FAMILY = '"JetBrains Mono", "Pretendard JP", "Segoe UI", monospace';
const MERMAID_FONT_SIZE_PX = "12px";
const EDGE_LABEL_PILL_PADDING_X = 6;
const MERMAID_TOGGLE_ICON_UP = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M10.53 7.22a.75.75 0 0 0-1.06 0L5.22 11.47a.75.75 0 1 0 1.06 1.06L10 8.81l3.72 3.72a.75.75 0 0 0 1.06-1.06l-4.25-4.25Z"/></svg>';
const MERMAID_TOGGLE_ICON_DOWN = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M5.22 8.53a.75.75 0 0 1 1.06-1.06L10 11.19l3.72-3.72a.75.75 0 0 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.53Z"/></svg>';
type MermaidApi = typeof import("mermaid")["default"];

let mermaidInitialized = false;
let mermaidRenderCount = 0;
let mermaidApi: MermaidApi | null = null;
let mermaidApiPromise: Promise<MermaidApi> | null = null;
let mermaidFontsReadyPromise: Promise<void> | null = null;

function normalizeLanguage(language: unknown): string {
  return typeof language === "string" ? language.trim().toLowerCase() : "";
}

function isMermaidLanguage(language: unknown): boolean {
  return normalizeLanguage(language) === MERMAID_LANGUAGE;
}

async function ensureMermaidFontsReady() {
  if (mermaidFontsReadyPromise) {
    return mermaidFontsReadyPromise;
  }

  mermaidFontsReadyPromise = (async () => {
    const fontFaceSet = document.fonts;
    if (!fontFaceSet?.load) {
      return;
    }

    await Promise.allSettled([
      fontFaceSet.load(`${MERMAID_FONT_SIZE_PX} "JetBrains Mono"`),
      fontFaceSet.load(`${MERMAID_FONT_SIZE_PX} "Pretendard JP"`),
      fontFaceSet.ready,
    ]);
  })();

  return mermaidFontsReadyPromise;
}

async function getMermaid() {
  if (mermaidApi) {
    return mermaidApi;
  }

  if (!mermaidApiPromise) {
    mermaidApiPromise = import("mermaid").then((module) => module.default);
  }

  mermaidApi = await mermaidApiPromise;

  if (!mermaidInitialized) {
    mermaidApi.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "neutral",
      suppressErrorRendering: true,
      fontFamily: MERMAID_FONT_FAMILY,
      flowchart: {
        htmlLabels: false,
        useMaxWidth: false,
      },
      themeVariables: {
        fontFamily: MERMAID_FONT_FAMILY,
        fontSize: MERMAID_FONT_SIZE_PX,
      },
    });
    mermaidInitialized = true;
  }

  return mermaidApi;
}

class MermaidCodeBlockView implements NodeView {
  dom: HTMLDivElement;
  contentDOM: HTMLElement;

  private node: ProseMirrorNode;
  private readonly preElement: HTMLPreElement;
  private readonly codeElement: HTMLElement;
  private readonly toggleButton: HTMLButtonElement;
  private readonly previewElement: HTMLDivElement;
  private readonly errorElement: HTMLDivElement;
  private codeCollapsed = false;
  private renderToken = 0;
  private renderTimeout: number | null = null;
  private lastRenderKey = "";

  constructor(node: ProseMirrorNode) {
    this.node = node;

    this.dom = document.createElement("div");
    this.dom.className = "noten-code-block";

    this.preElement = document.createElement("pre");
    this.codeElement = document.createElement("code");
    this.preElement.append(this.codeElement);

    this.toggleButton = document.createElement("button");
    this.toggleButton.type = "button";
    this.toggleButton.className = "noten-mermaid-code-toggle";
    this.toggleButton.addEventListener("mousedown", this.handleToggleMouseDown);
    this.preElement.append(this.toggleButton);

    this.contentDOM = this.codeElement;

    this.previewElement = document.createElement("div");
    this.previewElement.className = "noten-mermaid-preview";
    this.previewElement.hidden = true;

    this.errorElement = document.createElement("div");
    this.errorElement.className = "noten-mermaid-error";
    this.errorElement.hidden = true;

    this.dom.append(this.preElement, this.previewElement, this.errorElement);

    this.syncStructureFromNode();
    this.scheduleRender(true);
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }

    this.node = node;
    this.syncStructureFromNode();
    this.scheduleRender();
    return true;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === "selection") {
      return false;
    }

    if (this.toggleButton.contains(mutation.target)) {
      return true;
    }

    return this.previewElement.contains(mutation.target) || this.errorElement.contains(mutation.target);
  }

  destroy() {
    this.renderToken += 1;
    this.clearRenderTimeout();
    this.toggleButton.removeEventListener("mousedown", this.handleToggleMouseDown);
  }

  private syncStructureFromNode() {
    const language = typeof this.node.attrs.language === "string" ? this.node.attrs.language : "";
    this.preElement.dataset.language = language;
    this.codeElement.className = language ? `language-${language}` : "";

    const isMermaid = isMermaidLanguage(language);
    this.dom.classList.toggle("is-mermaid", isMermaid);
    this.toggleButton.hidden = !isMermaid;
    if (!isMermaid) {
      this.setCodeCollapsed(false);
    } else {
      this.syncToggleButton();
    }

    if (!isMermaid) {
      this.previewElement.hidden = true;
      this.previewElement.innerHTML = "";
      this.errorElement.hidden = true;
      this.errorElement.textContent = "";
      this.lastRenderKey = "";
      this.clearRenderTimeout();
    }
  }

  private scheduleRender(force = false) {
    if (!isMermaidLanguage(this.node.attrs.language)) {
      return;
    }

    const source = this.node.textContent;
    const renderKey = `${normalizeLanguage(this.node.attrs.language)}\u0000${source}`;

    if (!force && renderKey === this.lastRenderKey) {
      return;
    }

    this.lastRenderKey = renderKey;
    this.clearRenderTimeout();
    this.renderTimeout = window.setTimeout(() => {
      void this.renderPreview(source);
    }, MERMAID_RENDER_DELAY_MS);
  }

  private clearRenderTimeout() {
    if (this.renderTimeout === null) {
      return;
    }

    window.clearTimeout(this.renderTimeout);
    this.renderTimeout = null;
  }

  private readonly handleToggleMouseDown = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    this.setCodeCollapsed(!this.codeCollapsed);
  };

  private setCodeCollapsed(next: boolean) {
    if (this.codeCollapsed === next) {
      return;
    }

    this.codeCollapsed = next;
    this.dom.classList.toggle("is-code-collapsed", next);
    this.preElement.classList.toggle("is-code-collapsed", next);
    this.codeElement.hidden = next;
    this.syncToggleButton();
  }

  private syncToggleButton() {
    this.toggleButton.dataset.collapsed = this.codeCollapsed ? "true" : "false";
    this.toggleButton.innerHTML = this.codeCollapsed ? MERMAID_TOGGLE_ICON_DOWN : MERMAID_TOGGLE_ICON_UP;
    this.toggleButton.setAttribute("aria-pressed", this.codeCollapsed ? "true" : "false");
    this.toggleButton.setAttribute("aria-label", this.codeCollapsed ? "Expand Mermaid source" : "Collapse Mermaid source");
    this.toggleButton.setAttribute("title", this.codeCollapsed ? "Expand Mermaid source" : "Collapse Mermaid source");
  }

  private applyEdgeLabelPillShape(svgElement: SVGSVGElement) {
    const labels = svgElement.querySelectorAll<SVGGraphicsElement>(".edgeLabel rect, .edgeLabel .labelBkg");

    labels.forEach((rect) => {
      if (!(rect instanceof SVGRectElement)) {
        return;
      }

      const width = rect.width.baseVal.value;
      const height = rect.height.baseVal.value;
      const x = rect.x.baseVal.value;

      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return;
      }

      rect.x.baseVal.value = x - EDGE_LABEL_PILL_PADDING_X;
      rect.width.baseVal.value = width + EDGE_LABEL_PILL_PADDING_X * 2;
      rect.rx.baseVal.value = height / 2;
      rect.ry.baseVal.value = height / 2;
    });
  }

  private async renderPreview(source: string) {
    this.renderTimeout = null;

    const token = ++this.renderToken;

    if (!source.trim()) {
      this.previewElement.hidden = true;
      this.previewElement.innerHTML = "";
      this.errorElement.hidden = true;
      this.errorElement.textContent = "";
      return;
    }

    try {
      const mermaid = await getMermaid();
      await ensureMermaidFontsReady();
      mermaidRenderCount += 1;
      const renderId = `noten-mermaid-${mermaidRenderCount}`;
      const { svg, bindFunctions } = await mermaid.render(renderId, source);

      if (token !== this.renderToken) {
        return;
      }

      this.previewElement.innerHTML = svg;
      const svgElement = this.previewElement.querySelector("svg");
      if (svgElement) {
        svgElement.classList.add("noten-mermaid-svg");
        this.applyEdgeLabelPillShape(svgElement);
      }
      bindFunctions?.(this.previewElement);
      this.previewElement.hidden = false;
      this.errorElement.hidden = true;
      this.errorElement.textContent = "";
    } catch (error) {
      if (token !== this.renderToken) {
        return;
      }

      this.previewElement.hidden = true;
      this.previewElement.innerHTML = "";
      this.errorElement.hidden = false;
      this.errorElement.textContent = error instanceof Error ? error.message : String(error);
    }
  }
}

export const MermaidCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node }: NodeViewRendererProps) => new MermaidCodeBlockView(node);
  },

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
});

export default MermaidCodeBlock;
