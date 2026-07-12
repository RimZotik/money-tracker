import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MONTHS, MONTHS_SHORT, pad, ymd } from "../api";
import { usePopover } from "./usePopover";

export interface Range {
  from?: string;
  to?: string;
}

interface Props {
  value: Range;
  onChange: (r: Range) => void;
}

type Zoom = "month" | "year";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/** Быстрые пресеты — то, что выбирают в 90% случаев. */
function presets(): { label: string; range: Range }[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const prevMonth = new Date(y, m - 1, 1);
  return [
    {
      label: "Этот месяц",
      range: { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) },
    },
    {
      label: "Прошлый месяц",
      range: {
        from: ymd(prevMonth),
        to: ymd(new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0)),
      },
    },
    {
      label: "Этот год",
      range: { from: `${y}-01-01`, to: `${y}-12-31` },
    },
    {
      label: "Прошлый год",
      range: { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
    },
    { label: "Всё время", range: {} },
  ];
}

function label(r: Range): string {
  if (!r.from && !r.to) return "Всё время";
  const f = r.from ? fmt(r.from) : "…";
  const t = r.to ? fmt(r.to) : "…";
  return r.from === r.to ? f : `${f} — ${t}`;
}

function fmt(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${+d} ${MONTHS_SHORT[+m - 1]} ${y}`;
}

/**
 * Календарь с выбором диапазона: первый клик ставит начало, второй — конец.
 * Дни внутри выбранного периода подсвечиваются сплошной лентой.
 * Масштаб переключается между месяцем (клик по дням) и годом (клик по месяцам).
 */
export default function DateRangePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState<Zoom>("month");
  const [cursor, setCursor] = useState(() =>
    value.from ? new Date(value.from) : new Date()
  );
  // Первый клик запоминается здесь; второй завершает диапазон.
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const popStyle = usePopover(box, pop, open);

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (box.current && !box.current.contains(ev.target as Node)) {
        setOpen(false);
        setAnchor(null);
      }
    };
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Пока диапазон не закрыт, лента тянется за курсором
  const preview: Range = anchor
    ? { from: min(anchor, hover ?? anchor), to: max(anchor, hover ?? anchor) }
    : value;

  function pickDay(iso: string) {
    if (!anchor) {
      setAnchor(iso);
      return;
    }
    onChange({ from: min(anchor, iso), to: max(anchor, iso) });
    setAnchor(null);
    setOpen(false);
  }

  function pickMonth(monthIdx: number) {
    const y = cursor.getFullYear();
    const first = ymd(new Date(y, monthIdx, 1));
    const last = ymd(new Date(y, monthIdx + 1, 0));
    if (!anchor) {
      setAnchor(first);
      return;
    }
    // Диапазон месяцев: от начала первого до конца последнего
    const a = anchor;
    onChange({ from: min(a, first), to: max(endOfMonth(a), last) });
    setAnchor(null);
    setOpen(false);
  }

  const grid = monthGrid(cursor);
  const year = cursor.getFullYear();

  return (
    <div className="range" ref={box}>
      <button
        className={`btn range-btn ${open ? "on" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        {label(value)}
        {(value.from || value.to) && (
          <span
            className="range-clear"
            onClick={(ev) => {
              ev.stopPropagation();
              onChange({});
              setOpen(false);
            }}
            title="Сбросить период"
          >
            <X size={13} />
          </span>
        )}
      </button>

      {open && (
        <div className="range-pop" ref={pop} style={popStyle}>
          <div className="range-side">
            {presets().map((p) => (
              <button
                key={p.label}
                className="range-preset"
                onClick={() => {
                  onChange(p.range);
                  setAnchor(null);
                  setOpen(false);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="range-main">
            <div className="range-head">
              <button
                className="btn ghost sm"
                onClick={() =>
                  setCursor(
                    zoom === "month"
                      ? new Date(year, cursor.getMonth() - 1, 1)
                      : new Date(year - 1, 0, 1)
                  )
                }
              >
                <ChevronLeft size={16} />
              </button>

              <div className="range-zoom">
                <button
                  className={zoom === "month" ? "on" : ""}
                  onClick={() => setZoom("month")}
                >
                  {MONTHS[cursor.getMonth()]}
                </button>
                <button
                  className={zoom === "year" ? "on" : ""}
                  onClick={() => setZoom("year")}
                >
                  {year}
                </button>
              </div>

              <button
                className="btn ghost sm"
                onClick={() =>
                  setCursor(
                    zoom === "month"
                      ? new Date(year, cursor.getMonth() + 1, 1)
                      : new Date(year + 1, 0, 1)
                  )
                }
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {zoom === "month" ? (
              <>
                <div className="range-week">
                  {WEEKDAYS.map((w) => (
                    <span key={w}>{w}</span>
                  ))}
                </div>
                <div className="range-grid">
                  {grid.map((cell, i) => {
                    if (!cell) return <span key={i} />;
                    const iso = cell;
                    const inRange = within(iso, preview);
                    const isStart = iso === preview.from;
                    const isEnd = iso === preview.to;
                    const other = new Date(iso).getMonth() !== cursor.getMonth();
                    return (
                      <button
                        key={i}
                        className={[
                          "range-day",
                          inRange ? "in" : "",
                          isStart ? "start" : "",
                          isEnd ? "end" : "",
                          other ? "dim" : "",
                          iso === ymd(new Date()) ? "today" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => pickDay(iso)}
                        onMouseEnter={() => setHover(iso)}
                      >
                        {+iso.slice(-2)}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="range-months">
                {MONTHS.map((m, i) => {
                  const first = ymd(new Date(year, i, 1));
                  const last = ymd(new Date(year, i + 1, 0));
                  const inRange =
                    within(first, preview) || within(last, preview);
                  return (
                    <button
                      key={m}
                      className={`range-month ${inRange ? "in" : ""}`}
                      onClick={() => pickMonth(i)}
                      onMouseEnter={() => setHover(last)}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="range-hint">
              {anchor
                ? `Начало ${fmt(anchor)} — выберите конец периода`
                : "Кликните начало и конец периода"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── помощники ──────────────────────────────────────────────────────────────

const min = (a: string, b: string) => (a <= b ? a : b);
const max = (a: string, b: string) => (a >= b ? a : b);

function endOfMonth(iso: string): string {
  const d = new Date(iso);
  return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

function within(iso: string, r: Range): boolean {
  if (!r.from || !r.to) return false;
  return iso >= r.from && iso <= r.to;
}

/** Сетка 6×7 с днями месяца плюс хвосты соседних — как в банковских календарях. */
function monthGrid(cursor: Date): (string | null)[] {
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const first = new Date(y, m, 1);
  // В России неделя начинается с понедельника
  const shift = (first.getDay() + 6) % 7;
  const start = new Date(y, m, 1 - shift);

  const cells: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  return cells;
}
