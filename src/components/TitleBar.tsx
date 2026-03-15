import {
  Button,
  Tooltip,
  tokens,
  makeStyles,
} from "@fluentui/react-components";
import {
  WeatherMoon20Regular,
  WeatherSunny20Regular,
  Subtract20Regular,
  Dismiss20Regular,
  Square20Regular,
} from "@fluentui/react-icons";
import { getCurrentWindow } from "@tauri-apps/api/window";

const useStyles = makeStyles({
  titleBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: "40px",
    paddingLeft: "12px",
    paddingRight: "0px",
    backgroundColor: "transparent",
    userSelect: "none",
    position: "relative",
    zIndex: 2,
  },
  left: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: 0,
  },
  appIcon: {
    width: "16px",
    height: "16px",
    fontSize: "16px",
  },
  appName: {
    fontSize: "12px",
    fontWeight: 500,
    color: tokens.colorNeutralForeground1,
    whiteSpace: "nowrap",
  },
  fileName: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  dragRegion: {
    flex: 1,
    height: "100%",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginRight: "12px",
  },

  /* 밑줄 탭 스타일 모드 셀렉터 */
  tabGroup: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    height: "100%",
  },
  tab: {
    position: "relative",
    border: "none",
    borderRadius: "4px",
    fontSize: "12px",
    minWidth: "auto",
    paddingLeft: "8px",
    paddingRight: "8px",
    height: "26px",
    color: tokens.colorNeutralForeground2,
    cursor: "pointer",
  },
  tabActive: {
    position: "relative",
    border: "none",
    borderRadius: "4px",
    fontSize: "12px",
    fontWeight: 500,
    minWidth: "auto",
    paddingLeft: "8px",
    paddingRight: "8px",
    height: "26px",
    color: tokens.colorNeutralForeground1,
    "::after": {
      content: '""',
      position: "absolute",
      bottom: "0px",
      left: "8px",
      right: "8px",
      height: "2px",
      borderRadius: "1px",
      backgroundColor: tokens.colorBrandForeground1,
    },
  },

  windowControls: {
    display: "flex",
    alignItems: "center",
    height: "100%",
  },
  controlBtn: {
    minWidth: "46px",
    height: "40px",
    borderRadius: "0",
    border: "none",
  },
  closeBtn: {
    minWidth: "46px",
    height: "40px",
    borderRadius: "0",
    border: "none",
    ":hover": {
      backgroundColor: "#c42b1c",
      color: "#ffffff",
    },
  },
});

interface TitleBarProps {
  filePath: string | null;
  isDirty: boolean;
  isEditing: boolean;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  onToggleEditing: () => void;
}

export function TitleBar({
  filePath,
  isDirty,
  isEditing,
  isDarkMode,
  onToggleDarkMode,
  onToggleEditing,
}: TitleBarProps) {
  const styles = useStyles();
  const appWindow = getCurrentWindow();

  const fileName = filePath ? filePath.split(/[\\/]/).pop() : null;
  const displayName = fileName
    ? `${fileName}${isDirty ? " ●" : ""}`
    : isDirty
      ? "Untitled ●"
      : "";

  return (
    <div className={styles.titleBar} data-tauri-drag-region>
      <div className={styles.left} data-tauri-drag-region>
        <span className={styles.appIcon}>📝</span>
        <span className={styles.appName}>Markdown Studio</span>
        {displayName && (
          <>
            <span className={styles.appName}>—</span>
            <span className={styles.fileName}>{displayName}</span>
          </>
        )}
      </div>

      <div className={styles.dragRegion} data-tauri-drag-region />

      <div className={styles.actions}>
        <div className={styles.tabGroup}>
          <Button
            appearance="subtle"
            className={!isEditing ? styles.tabActive : styles.tab}
            onClick={() => isEditing && onToggleEditing()}
            size="small"
          >
            읽기
          </Button>
          <Button
            appearance="subtle"
            className={isEditing ? styles.tabActive : styles.tab}
            onClick={() => !isEditing && onToggleEditing()}
            size="small"
          >
            편집
          </Button>
        </div>

        <Tooltip
          content={isDarkMode ? "Light mode" : "Dark mode"}
          relationship="label"
        >
          <Button
            appearance="subtle"
            icon={isDarkMode ? <WeatherSunny20Regular /> : <WeatherMoon20Regular />}
            onClick={onToggleDarkMode}
            size="small"
          />
        </Tooltip>
      </div>

      <div className={styles.windowControls}>
        <Button
          appearance="subtle"
          icon={<Subtract20Regular />}
          className={styles.controlBtn}
          onClick={() => appWindow.minimize()}
        />
        <Button
          appearance="subtle"
          icon={<Square20Regular />}
          className={styles.controlBtn}
          onClick={() => appWindow.toggleMaximize()}
        />
        <Button
          appearance="subtle"
          icon={<Dismiss20Regular />}
          className={styles.closeBtn}
          onClick={() => appWindow.close()}
        />
      </div>
    </div>
  );
}
