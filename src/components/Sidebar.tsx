import { makeStyles, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
  sidebar: {
    display: "flex",
    flexDirection: "column",
    width: "var(--shell-sidebar-width)",
    height: "100%",
    backgroundColor: "transparent",
    flexShrink: 0,
    /* 토글 버튼(top:12 + 3+28+3 = 46px) 아래부터 콘텐츠 시작 */
    paddingTop: "50px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    height: "32px",
    paddingLeft: "16px",
    paddingRight: "16px",
    fontSize: "12px",
    fontWeight: 500,
    color: tokens.colorNeutralForeground2,
    flexShrink: 0,
  },
  body: {
    flex: 1,
    overflow: "auto",
    paddingLeft: "16px",
    paddingRight: "16px",
    paddingTop: "4px",
  },
  placeholder: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground3,
    lineHeight: "1.6",
  },
});

export function Sidebar() {
  const styles = useStyles();

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>탐색</div>
      <div className={styles.body}>
        <span className={styles.placeholder}>
          파일 목록이 여기에 표시됩니다.
        </span>
      </div>
    </div>
  );
}
