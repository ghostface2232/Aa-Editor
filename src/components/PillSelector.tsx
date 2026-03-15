import { Button, makeStyles, tokens } from "@fluentui/react-components";

const PILL_PADDING = "3px";
const BTN_HEIGHT = "28px";
const BTN_PADDING_X = "10px";
const FONT_SIZE = "12px";
const RADIUS = "8px";
const INNER_RADIUS = "6px";

const useStyles = makeStyles({
  pill: {
    display: "inline-flex",
    alignItems: "center",
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: RADIUS,
    padding: PILL_PADDING,
    gap: "2px",
  },
  btn: {
    borderRadius: INNER_RADIUS,
    border: "none",
    fontSize: FONT_SIZE,
    minWidth: "auto",
    paddingLeft: BTN_PADDING_X,
    paddingRight: BTN_PADDING_X,
    height: BTN_HEIGHT,
  },
  btnActive: {
    borderRadius: INNER_RADIUS,
    border: "none",
    fontSize: FONT_SIZE,
    minWidth: "auto",
    paddingLeft: BTN_PADDING_X,
    paddingRight: BTN_PADDING_X,
    height: BTN_HEIGHT,
    backgroundColor: tokens.colorNeutralBackground4,
    fontWeight: 500,
  },
});

interface PillSelectorProps {
  items: { key: string; label: React.ReactNode }[];
  activeKey: string;
  onSelect: (key: string) => void;
  className?: string;
}

export function PillSelector({
  items,
  activeKey,
  onSelect,
  className,
}: PillSelectorProps) {
  const styles = useStyles();

  return (
    <div className={`${styles.pill}${className ? ` ${className}` : ""}`}>
      {items.map((item) => (
        <Button
          key={item.key}
          appearance="subtle"
          className={item.key === activeKey ? styles.btnActive : styles.btn}
          onClick={() => item.key !== activeKey && onSelect(item.key)}
          size="small"
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}
