import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  DocumentRegular,
  AddRegular,
} from "@fluentui/react-icons";
import type { Editor, Range } from "@tiptap/core";
import "../styles/slash-command.css";

export type WikiSuggestionItem =
  | {
      kind: "existing";
      title: string;
      noteId: string;
    }
  | {
      kind: "create";
      title: string;
      createLabel: string;
    };

export interface WikiSuggestionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface WikiSuggestionListProps {
  items: WikiSuggestionItem[];
  command: (item: WikiSuggestionItem) => void;
  // Extras surfaced via the props passed by Suggestion
  editor?: Editor;
  range?: Range;
}

export const WikiSuggestionList = forwardRef<
  WikiSuggestionListRef,
  WikiSuggestionListProps
>(function WikiSuggestionList({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  useLayoutEffect(() => {
    const container = listRef.current;
    const el = container?.children[selectedIndex] as HTMLElement | undefined;
    if (!container || !el) return;

    const cTop = container.scrollTop;
    const cBottom = cTop + container.clientHeight;
    const eTop = el.offsetTop;
    const eBottom = eTop + el.offsetHeight;

    if (eTop < cTop) {
      container.scrollTop = eTop;
    } else if (eBottom > cBottom) {
      container.scrollTop = eBottom - container.clientHeight;
    }
  }, [selectedIndex]);

  const selectItem = useCallback(
    (index: number) => {
      const item = items[index];
      if (item) command(item);
    },
    [items, command],
  );

  useImperativeHandle(ref, () => ({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) return null;

  return (
    <div className="slash-command-menu wiki-suggestion-menu" ref={listRef}>
      {items.map((item, index) => {
        const isCreate = item.kind === "create";
        const title = isCreate ? item.createLabel : item.title;
        const description = isCreate ? item.title : null;
        return (
          <button
            key={isCreate ? `__create__:${item.title}` : item.noteId}
            className={`slash-command-item${index === selectedIndex ? " is-selected" : ""}`}
            onClick={() => selectItem(index)}
            onMouseEnter={() => setSelectedIndex(index)}
            type="button"
          >
            <span className="slash-command-icon">
              {isCreate ? <AddRegular /> : <DocumentRegular />}
            </span>
            <span className="slash-command-text">
              <span className="slash-command-title">{title}</span>
              {description && (
                <span className="slash-command-desc">{description}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
});
