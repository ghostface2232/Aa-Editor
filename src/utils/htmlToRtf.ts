/** Minimal HTML → RTF converter. Supports headings, bold, italic, underline, lists. */
export function htmlToRtf(html: string): string {
  const header =
    "{\\rtf1\\ansi\\deff0" +
    "{\\fonttbl{\\f0 Calibri;}{\\f1 Consolas;}}" +
    "{\\colortbl ;\\red0\\green0\\blue0;}" +
    "\\f0\\fs24\\cf1\n";

  let rtf = "";
  let listDepth = 0;
  let orderedCounter = 0;

  const push = (text: string) => { rtf += text; };

  // Strip tags and convert entities
  const decodeEntities = (s: string) =>
    s.replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");

  const escapeRtf = (s: string) => {
    const decoded = decodeEntities(s);
    let out = "";
    for (const ch of decoded) {
      const code = ch.codePointAt(0)!;
      if (ch === "\\") out += "\\\\";
      else if (ch === "{") out += "\\{";
      else if (ch === "}") out += "\\}";
      else if (ch === "\n") continue;
      else if (code > 127) {
        // RTF Unicode escape: \uN followed by a fallback char '?'
        const signed = code > 32767 ? code - 65536 : code;
        out += `\\u${signed}?`;
      } else {
        out += ch;
      }
    }
    return out;
  };

  // Simple tag-based parser
  const tagRegex = /<\/?([a-z][a-z0-9]*)[^>]*>|([^<]+)/gi;
  let match: RegExpExecArray | null;
  const stack: string[] = [];

  while ((match = tagRegex.exec(html)) !== null) {
    if (match[2]) {
      // Text node
      push(escapeRtf(match[2]));
      continue;
    }

    const full = match[0];
    const tag = match[1].toLowerCase();
    const isClose = full.startsWith("</");

    if (isClose) {
      // Closing tags
      switch (tag) {
        case "b": case "strong": push("}"); break;
        case "i": case "em": push("}"); break;
        case "u": push("}"); break;
        case "code": push("}"); break;
        case "h1": case "h2": case "h3": case "h4": push("}\\fs24\\b0\\par\n"); break;
        case "p": case "blockquote": push("\\par\n"); break;
        case "li": push("\\par\n"); break;
        case "ul": listDepth = Math.max(0, listDepth - 1); break;
        case "ol": listDepth = Math.max(0, listDepth - 1); orderedCounter = 0; break;
        case "pre": push("}\\f0\\fs24\\par\n"); break;
      }
      if (stack[stack.length - 1] === tag) stack.pop();
    } else {
      // Opening tags
      stack.push(tag);
      const indent = listDepth * 360;
      switch (tag) {
        case "b": case "strong": push("{\\b "); break;
        case "i": case "em": push("{\\i "); break;
        case "u": push("{\\ul "); break;
        case "code": push("{\\f1 "); break;
        case "h1": push("{\\fs48\\b "); break;
        case "h2": push("{\\fs36\\b "); break;
        case "h3": push("{\\fs30\\b "); break;
        case "h4": push("{\\fs26\\b "); break;
        case "p": break;
        case "blockquote": push("\\li360 "); break;
        case "br": push("\\line\n"); break;
        case "hr": push("\\pard\\brdrb\\brdrs\\brdrw10\\brsp20\\par\n"); break;
        case "ul": listDepth++; break;
        case "ol": listDepth++; orderedCounter = 0; break;
        case "li":
          if (stack.includes("ol")) {
            orderedCounter++;
            push(`\\li${indent}\\fi-360 ${orderedCounter}. `);
          } else {
            push(`\\li${indent}\\fi-360 \\bullet  `);
          }
          break;
        case "pre": push("{\\f1\\fs20 "); break;
      }
    }
  }

  return header + rtf + "}";
}
