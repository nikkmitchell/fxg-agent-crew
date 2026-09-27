/**
 * The headset settings, as ONE drawn panel: where everything goes, and what a
 * point on it is.
 *
 * WHY ONE PANEL. The menu was a grid of separate meshes — a slab per section,
 * a flat rounded shape per button, a texture of words laid on each — and Nikk,
 * three times in an hour: "it still looks really bad", "much cleaner", "make
 * the UI look nice and more organised" (5426, 5439). Flat shapes cannot carry
 * a border, a separator, a switch or a hover, and every section floated on its
 * own. Painted once into a canvas, the menu is a single card with a segmented
 * tab bar, grouped lists, switches and values, and it is drawn in one call.
 *
 * HORIZONTAL AND NEVER TALLER (Nikk, 5445): "show up horizontally so the menu
 * never increases in height". Every tab is the same height — the header and
 * `maxRows` rows — and a section with more rows than that continues into the
 * next column to the right.
 *
 * PURE: the layout and the hit test are decided here and tested without a
 * renderer. menu-paint.ts draws a layout; SettingsMenu3D.tsx puts it in the
 * room and turns a pointer into one of its targets.
 */

export type MenuTone = "normal" | "accent" | "danger";

export type MenuRow =
  /** On or off: a switch on the right. */
  | { kind: "toggle"; label: string; on: boolean; detail?: string; disabled?: boolean; onTap: () => void }
  /** Something that happens when pressed. `value` is shown dimmer on the right. */
  | { kind: "action"; label: string; tone?: MenuTone; value?: string; onTap: () => void }
  /** Opens another list: a chevron on the right. */
  | { kind: "link"; label: string; value?: string; onTap: () => void }
  /** One of a set: a check on the right when chosen. */
  | { kind: "choice"; label: string; selected: boolean; onTap: () => void }
  /** A value with − and + beside it. Pressing the label itself is `onTap`, if there is one. */
  | { kind: "stepper"; label: string; value: string; onLess: () => void; onMore: () => void; onTap?: () => void }
  /** A name with a few small buttons after it: the agents' "face me · beside · desk". */
  | { kind: "buttons"; label: string; buttons: { label: string; onTap: () => void }[] }
  /** Words, not a control. */
  | { kind: "note"; label: string };

export type MenuSection = {
  title: string;
  rows: MenuRow[];
  /** A wider column, for rows with buttons in them. */
  wide?: boolean;
};

export type MenuTab = { id: string; label: string };

export type MenuModel = {
  title: string;
  tabs: readonly MenuTab[];
  active: string;
  onTab: (id: string) => void;
  onClose: () => void;
  sections: readonly MenuSection[];
  /** A small accent button beside the title: "Update", when there is a new version. */
  badge?: { label: string; onTap: () => void } | null;
};

/** Canvas pixels. `pxPerMetre` turns them into the room's metres. */
export const MENU = {
  /**
   * About what a Quest 3 resolves at the menu's distance (1.95 m): one degree
   * there is 3.4 cm, which the headset shows with about 25 pixels, and this
   * gives it 29 texels. Finer is wasted upload; coarser blurs the words.
   */
  pxPerMetre: 900,
  pad: 30,
  headerHeight: 64,
  headerGap: 22,
  captionHeight: 40,
  rowHeight: 82,
  maxRows: 5,
  columnWidth: 440,
  wideColumnWidth: 700,
  columnGap: 24,
  /** Wide enough for the title, an update button, five tabs and the close button. */
  minWidth: 1420,
  radius: 46,
  cardRadius: 24,
  tabWidth: 176,
  tabHeight: 56,
  closeSize: 56,
  badgeHeight: 48,
  badgeWidth: 180,
  /** Stepper: two round buttons and the value between them. */
  stepButton: 52,
  stepValue: 96,
  /** A small button in a `buttons` row. */
  pillWidth: 118,
  pillHeight: 50,
  pillGap: 10,
  switchWidth: 72,
  switchHeight: 42,
  rowInset: 24,
} as const;

export type Rect = { x: number; y: number; width: number; height: number };

export type MenuTarget = Rect & { id: string; onTap: () => void };

export type LaidRow = { row: MenuRow; id: string; rect: Rect; first: boolean; last: boolean };

export type LaidColumn = {
  /** Empty for a column that continues the section before it. */
  title: string;
  x: number;
  width: number;
  /** The grouped-list card the rows sit on. */
  card: Rect;
  rows: LaidRow[];
};

export type MenuLayout = {
  width: number;
  height: number;
  title: string;
  tabs: (Rect & { id: string; label: string; active: boolean })[];
  /** The rounded track the tabs sit in. */
  tabTrack: Rect;
  close: Rect;
  badge: (Rect & { label: string }) | null;
  columns: LaidColumn[];
  targets: MenuTarget[];
};

/** The panel is always this tall, whatever tab is open. */
export function menuHeight(size = MENU): number {
  return size.pad + size.headerHeight + size.headerGap + size.captionHeight + size.maxRows * size.rowHeight + size.pad;
}

/** Split sections into columns of at most `maxRows` rows, in order. */
export function menuColumns(sections: readonly MenuSection[], maxRows: number = MENU.maxRows) {
  const columns: { title: string; wide: boolean; section: number; rows: { row: MenuRow; index: number }[] }[] = [];
  sections.forEach((section, sectionIndex) => {
    const rows = section.rows.length ? section.rows : [{ kind: "note", label: "Nothing here yet" } as MenuRow];
    for (let start = 0; start < rows.length; start += maxRows) {
      columns.push({
        title: start === 0 ? section.title : "",
        wide: Boolean(section.wide),
        section: sectionIndex,
        rows: rows.slice(start, start + maxRows).map((row, offset) => ({ row, index: start + offset })),
      });
    }
  });
  return columns;
}

export function layOutMenu(model: MenuModel, size = MENU): MenuLayout {
  const split = menuColumns(model.sections, size.maxRows);
  const widths = split.map((column) => (column.wide ? size.wideColumnWidth : size.columnWidth));
  const content = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * size.columnGap;
  const width = Math.max(size.minWidth, size.pad * 2 + content);
  const height = menuHeight(size);

  // THE HEADER: title on the left, the tabs as one segmented control in the
  // middle, close on the right.
  const headerMid = size.pad + size.headerHeight / 2;
  const trackWidth = model.tabs.length * size.tabWidth + 8;
  const tabTrack = { x: width / 2 - trackWidth / 2, y: headerMid - (size.tabHeight + 8) / 2, width: trackWidth, height: size.tabHeight + 8 };
  const tabs = model.tabs.map((tab, index) => ({
    id: tab.id,
    label: tab.label,
    active: tab.id === model.active,
    x: tabTrack.x + 4 + index * size.tabWidth,
    y: headerMid - size.tabHeight / 2,
    width: size.tabWidth,
    height: size.tabHeight,
  }));
  const close = { x: width - size.pad - size.closeSize, y: headerMid - size.closeSize / 2, width: size.closeSize, height: size.closeSize };

  // THE BADGE takes the title's place: an update matters more than a heading
  // telling you that the settings are the settings.
  const badge = model.badge
    ? { x: size.pad + 4, y: headerMid - size.badgeHeight / 2, width: Math.min(size.badgeWidth, tabTrack.x - size.pad - 24), height: size.badgeHeight, label: model.badge.label }
    : null;

  const targets: MenuTarget[] = [
    ...tabs.map((tab) => ({ id: `tab:${tab.id}`, x: tab.x, y: tab.y, width: tab.width, height: tab.height, onTap: () => model.onTab(tab.id) })),
    { id: "close", ...close, onTap: model.onClose },
    ...(badge && model.badge ? [{ id: "badge", x: badge.x, y: badge.y, width: badge.width, height: badge.height, onTap: model.badge.onTap }] : []),
  ];

  const top = size.pad + size.headerHeight + size.headerGap;
  const rowsTop = top + size.captionHeight;
  let x = size.pad;
  const columns: LaidColumn[] = split.map((column, columnIndex) => {
    const columnWidth = widths[columnIndex];
    const card = { x, y: rowsTop, width: columnWidth, height: column.rows.length * size.rowHeight };
    const rows: LaidRow[] = column.rows.map(({ row, index }, position) => {
      const id = `s${column.section}r${index}`;
      const rect = { x, y: rowsTop + position * size.rowHeight, width: columnWidth, height: size.rowHeight };
      targets.push(...rowTargets(row, id, rect, size));
      return { row, id, rect, first: position === 0, last: position === column.rows.length - 1 };
    });
    const laid = { title: column.title, x, width: columnWidth, card, rows };
    x += columnWidth + size.columnGap;
    return laid;
  });

  return { width, height, title: model.title, tabs, tabTrack, close, badge, columns, targets };
}

/** The pressable parts of one row. A note has none. */
export function rowTargets(row: MenuRow, id: string, rect: Rect, size = MENU): MenuTarget[] {
  const mid = rect.y + rect.height / 2;
  switch (row.kind) {
    case "note":
      return [];
    case "toggle":
      return row.disabled ? [] : [{ id, ...rect, onTap: row.onTap }];
    case "stepper": {
      const plus = { x: rect.x + rect.width - size.rowInset - size.stepButton, y: mid - size.stepButton / 2, width: size.stepButton, height: size.stepButton };
      const minus = { ...plus, x: plus.x - size.stepValue - size.stepButton };
      return [
        { id: `${id}:less`, ...minus, onTap: row.onLess },
        { id: `${id}:more`, ...plus, onTap: row.onMore },
        ...(row.onTap
          ? [{ id, x: rect.x, y: rect.y, width: minus.x - rect.x - 8, height: rect.height, onTap: row.onTap }]
          : []),
      ];
    }
    case "buttons": {
      const right = rect.x + rect.width - size.rowInset;
      return row.buttons.map((button, index) => {
        const fromRight = row.buttons.length - 1 - index;
        return {
          id: `${id}:b${index}`,
          x: right - size.pillWidth - fromRight * (size.pillWidth + size.pillGap),
          y: mid - size.pillHeight / 2,
          width: size.pillWidth,
          height: size.pillHeight,
          onTap: button.onTap,
        };
      });
    }
    default:
      return [{ id, ...rect, onTap: row.onTap }];
  }
}

/**
 * What is under a point, in canvas pixels. The smallest target wins, so a
 * stepper's + is found before the row it sits in.
 */
export function hitMenu(layout: MenuLayout, x: number, y: number): MenuTarget | null {
  let found: MenuTarget | null = null;
  for (const target of layout.targets) {
    if (x < target.x || x > target.x + target.width || y < target.y || y > target.y + target.height) continue;
    if (!found || target.width * target.height < found.width * found.height) found = target;
  }
  return found;
}

/**
 * A point on the panel's plane, in metres from its centre with y up, as
 * canvas pixels with y down.
 */
export function menuPixel(layout: Pick<MenuLayout, "width" | "height">, local: { x: number; y: number }, size = MENU) {
  return {
    x: local.x * size.pxPerMetre + layout.width / 2,
    y: layout.height / 2 - local.y * size.pxPerMetre,
  };
}

/**
 * Everything the picture depends on, as a string: repainting a two-thousand
 * pixel canvas is not free, and the menu re-renders far more often than it
 * changes (every notice, every recording tick).
 */
export function menuSignature(layout: MenuLayout, hover: string | null, pressed: string | null): string {
  const rows = layout.columns.flatMap((column) => [
    column.title,
    ...column.rows.map(({ row, id }) => {
      switch (row.kind) {
        case "toggle":
          return `${id}|t|${row.label}|${row.on}|${row.detail ?? ""}|${row.disabled ?? false}`;
        case "action":
          return `${id}|a|${row.label}|${row.tone ?? ""}|${row.value ?? ""}`;
        case "link":
          return `${id}|l|${row.label}|${row.value ?? ""}`;
        case "choice":
          return `${id}|c|${row.label}|${row.selected}`;
        case "stepper":
          return `${id}|s|${row.label}|${row.value}`;
        case "buttons":
          return `${id}|b|${row.label}|${row.buttons.map((button) => button.label).join(",")}`;
        default:
          return `${id}|n|${row.label}`;
      }
    }),
  ]);
  return [layout.width, layout.title, layout.badge?.label ?? "", ...layout.tabs.map((tab) => `${tab.label}${tab.active ? "*" : ""}`), ...rows, hover ?? "", pressed ?? ""].join("\u0001");
}
