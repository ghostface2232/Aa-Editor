import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import type { NodeViewRendererProps } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { NodeView, ViewMutationRecord } from "@tiptap/pm/view";

const MERMAID_LANGUAGE = "mermaid";
const MERMAID_RENDER_DELAY_MS = 120;
type MermaidApi = typeof import("mermaid")["default"];

let mermaidInitialized = false;
let mermaidRenderCount = 0;
let mermaidApi: MermaidApi | null = null;
let mermaidApiPromise: Promise<MermaidApi> | null = null;

function normalizeLanguage(language: unknown): string {
  return typeof language === "string" ? language.trim().toLowerCase() : "";
}

function isMermaidLanguage(language: unknown): boolean {
  return normalizeLanguage(language) === MERMAID_LANGUAGE;
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
  private readonly previewElement: HTMLDivElement;
  private readonly errorElement: HTMLDivElement;
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

    return this.previewElement.contains(mutation.target) || this.errorElement.contains(mutation.target);
  }

  destroy() {
    this.renderToken += 1;
    this.clearRenderTimeout();
  }

  private syncStructureFromNode() {
    const language = typeof this.node.attrs.language === "string" ? this.node.attrs.language : "";
    this.preElement.dataset.language = language;
    this.codeElement.className = language ? `language-${language}` : "";

    const isMermaid = isMermaidLanguage(language);
    this.dom.classList.toggle("is-mermaid", isMermaid);

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
      mermaidRenderCount += 1;
      const renderId = `noten-mermaid-${mermaidRenderCount}`;
      const { svg, bindFunctions } = await mermaid.render(renderId, source);

      if (token !== this.renderToken) {
        return;
      }

      this.previewElement.innerHTML = svg;
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
