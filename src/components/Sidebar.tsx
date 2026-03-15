import { Button, makeStyles, tokens } from "@fluentui/react-components";
import { SettingsRegular, DocumentRegular } from "@fluentui/react-icons";
import type { OpenDocument } from "../hooks/useFileSystem";

const SIDE_PADDING = "8px";

const useStyles = makeStyles({
  sidebar: {
    display: "flex",
    flexDirection: "column",
    width: "var(--shell-sidebar-width)",
    height: "100%",
    backgroundColor: "transparent",
    flexShrink: 0,
    paddingTop: "50px",
  },
  body: {
    flex: 1,
    overflow: "auto",
    paddingLeft: SIDE_PADDING,
    paddingRight: SIDE_PADDING,
    paddingTop: "4px",
  },
  docItem: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    justifyContent: "flex-start",
    border: "none",
    borderRadius: "6px",
    fontSize: "13px",
    gap: "8px",
    minHeight: "32px",
    paddingLeft: "8px",
    paddingRight: "8px",
  },
  docItemActive: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    justifyContent: "flex-start",
    border: "none",
    borderRadius: "6px",
    fontSize: "13px",
    gap: "8px",
    minHeight: "32px",
    paddingLeft: "8px",
    paddingRight: "8px",
    backgroundColor: "var(--ui-active-bg)",
    fontWeight: 500,
  },
  docName: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  dirty: {
    fontSize: "10px",
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
  empty: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground3,
    lineHeight: "1.6",
    paddingLeft: "8px",
    paddingRight: "8px",
  },
  footer: {
    flexShrink: 0,
    paddingLeft: SIDE_PADDING,
    paddingRight: SIDE_PADDING,
    paddingBottom: "12px",
  },
  settingsBtn: {
    width: "100%",
    justifyContent: "flex-start",
    border: "none",
    borderRadius: "6px",
    fontSize: "13px",
    gap: "8px",
    paddingLeft: "8px",
    paddingRight: "8px",
  },
});

interface SidebarProps {
  openDocuments: OpenDocument[];
  activeDocIndex: number;
  onSwitchDocument: (index: number) => void;
}

export function Sidebar({
  openDocuments,
  activeDocIndex,
  onSwitchDocument,
}: SidebarProps) {
  const styles = useStyles();

  return (
    <div className={styles.sidebar}>
      <div className={styles.body}>
        {openDocuments.length === 0 ? (
          <span className={styles.empty}>
            Ctrl+O로 파일을 열거나 Ctrl+N으로 새 문서를 만드세요.
          </span>
        ) : (
          openDocuments.map((doc, i) => (
            <Button
              key={doc.filePath || `untitled-${i}`}
              appearance="subtle"
              icon={<DocumentRegular />}
              className={i === activeDocIndex ? styles.docItemActive : styles.docItem}
              onClick={() => onSwitchDocument(i)}
              size="small"
            >
              <span className={styles.docName}>{doc.fileName}</span>
              {doc.isDirty && <span className={styles.dirty}>●</span>}
            </Button>
          ))
        )}
      </div>
      <div className={styles.footer}>
        <Button
          appearance="subtle"
          icon={<SettingsRegular />}
          className={styles.settingsBtn}
          size="small"
        >
          설정
        </Button>
      </div>
    </div>
  );
}
