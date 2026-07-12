import { Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, compact, formatPeriod, money, moneyShort, monthBounds } from "../api";
import DateRangePicker, { type Range } from "../components/DateRangePicker";
import Icon from "../components/Icon";
import { useStore } from "../store";
import type { CategoryStat, PeriodStat, Summary, TxFilter } from "../types";

const GREEN = "#35a877";
const RED = "#e0605e";
const ACCENT = "#5b8def";
const AXIS = "#656d80";
const GRID = "#2e3340";
const FALLBACK = "#7C8398";

const tooltipStyle = {
  background: "#21252f",
  border: "1px solid #2e3340",
  borderRadius: 8,
  color: "#e6e8ee",
  fontSize: 13,
};

export default function Dashboard() {
  const { accounts, loading: storeLoading, fail, track } = useStore();

  const [range, setRange] = useState<Range>(() => {
    const [from, to] = monthBounds();
    return { from, to };
  });
  // «Чистый» режим: возврат гасит исходный расход, а не считается доходом.
  const [net, setNet] = useState(true);

  const [sum, setSum] = useState<Summary | null>(null);
  const [expCats, setExpCats] = useState<CategoryStat[]>([]);
  const [incCats, setIncCats] = useState<CategoryStat[]>([]);
  const [periods, setPeriods] = useState<PeriodStat[]>([]);
  const [worth, setWorth] = useState<PeriodStat[]>([]);

  useEffect(() => {
    const filter: TxFilter = { from: range.from, to: range.to, net_refunds: net };
    // Внутри года удобнее видеть месяцы; на длинном горизонте — годы.
    const span = spanDays(range);
    const gran = span === null || span > 800 ? "year" : span > 62 ? "month" : "day";

    track(
      Promise.all([
        api.summary(filter),
        api.categoryStats("expense", filter),
        api.categoryStats("income", filter),
        api.periodStats(gran, filter),
        api.netWorthSeries(range.from, range.to),
      ])
    )
      .then(([s, ec, ic, p, w]) => {
        setSum(s);
        setExpCats(ec);
        setIncCats(ic);
        setPeriods(p);
        setWorth(w);
      })
      .catch(fail);
  }, [range, net, fail, track]);

  if (storeLoading || !sum) return <div className="empty">Загрузка…</div>;

  if (accounts.length === 0) {
    return (
      <div className="empty">
        <Wallet size={44} style={{ marginBottom: 14, opacity: 0.5 }} />
        <p style={{ fontSize: 16, color: "var(--text)", marginBottom: 8 }}>
          Добро пожаловать в Money Tracker
        </p>
        <div>
          Начните со <b>Счетов</b> — добавьте карту, кошелёк или наличные.
          <br />
          Потом создавайте операции: остатки и аналитика посчитаются сами.
        </div>
      </div>
    );
  }

  const savings = sum.income > 0 ? (sum.profit / sum.income) * 100 : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Дашборд</h1>
          <div className="sub">
            {sum.tx_count.toLocaleString("ru-RU")} операций за период
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <label className="switch" title="Возврат гасит исходный расход, а не считается доходом">
            <input type="checkbox" checked={net} onChange={(ev) => setNet(ev.target.checked)} />
            Зачитывать возвраты
          </label>
          <DateRangePicker value={range} onChange={setRange} />
        </div>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 18 }}>
        <div className="card stat">
          <div className="label">Доходы</div>
          <div className="value pos">{moneyShort(sum.income)}</div>
        </div>
        <div className="card stat">
          <div className="label">Расходы</div>
          <div className="value neg">{moneyShort(sum.expense)}</div>
          <div className="hint">
            {net && sum.refunded > 0
              ? `возвраты ${moneyShort(sum.refunded)} уже вычтены`
              : "без учёта тела кредитов"}
          </div>
        </div>
        <div className="card stat">
          <div className="label">Осталось</div>
          <div className={`value ${sum.profit >= 0 ? "pos" : "neg"}`}>
            {moneyShort(sum.profit)}
          </div>
          <div className="hint">
            {sum.income > 0
              ? `откладываете ${savings.toFixed(0)}% дохода`
              : "доходов за период нет"}
          </div>
        </div>
        <div className="card stat">
          <div className="label">Капитал сейчас</div>
          <div className={`value ${sum.net_worth >= 0 ? "" : "neg"}`}>
            {moneyShort(sum.net_worth)}
          </div>
          <div className="hint">
            {sum.total_debt > 0 ? (
              <span className="warn">долгов на {moneyShort(sum.total_debt)}</span>
            ) : (
              "долгов нет"
            )}
          </div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginBottom: 18 }}>
        <Donut title="Куда уходят деньги" subtitle="расходы по категориям" data={expCats} />
        <Donut title="Откуда приходят деньги" subtitle="доходы по категориям" data={incCats} />
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2 style={{ fontSize: 14, marginBottom: 4 }}>Доходы и расходы</h2>
          <div style={{ color: "var(--text-faint)", fontSize: 12, marginBottom: 14 }}>
            по периодам
          </div>
          {periods.length === 0 ? (
            <div className="empty" style={{ padding: 30 }}>
              Нет данных за период
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={periods} barGap={2}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis
                  dataKey="period"
                  stroke={AXIS}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  fontSize={12}
                  tickFormatter={formatPeriod}
                />
                <YAxis
                  stroke={AXIS}
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  tickFormatter={compact}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  labelFormatter={formatPeriod}
                  formatter={(v: number, n: string) => [money(v), n]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                <Bar dataKey="income" name="Доход" fill={GREEN} radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" name="Расход" fill={RED} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h2 style={{ fontSize: 14, marginBottom: 4 }}>Как менялся капитал</h2>
          <div style={{ color: "var(--text-faint)", fontSize: 12, marginBottom: 14 }}>
            нарастающим итогом по всем счетам
          </div>
          {worth.length === 0 ? (
            <div className="empty" style={{ padding: 30 }}>
              Нет данных за период
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={worth}>
                <defs>
                  <linearGradient id="worthFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis
                  dataKey="period"
                  stroke={AXIS}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  fontSize={12}
                  minTickGap={40}
                  tickFormatter={formatPeriod}
                />
                <YAxis
                  stroke={AXIS}
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  tickFormatter={compact}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={formatPeriod}
                  formatter={(v: number) => [money(v), "Капитал"]}
                />
                <Area
                  type="monotone"
                  dataKey="income"
                  name="Капитал"
                  stroke={ACCENT}
                  strokeWidth={2}
                  fill="url(#worthFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 14, marginBottom: 14 }}>Счета</h2>
        <div className="grid cols-4">
          {accounts.map((a) => (
            <div key={a.id}>
              <div style={{ color: "var(--text-faint)", fontSize: 12, marginBottom: 4 }}>
                {a.name}
              </div>
              <div
                style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
                className={
                  a.kind === "credit"
                    ? (a.debt ?? 0) > 0
                      ? "neg"
                      : "pos"
                    : a.balance < 0
                      ? "neg"
                      : ""
                }
              >
                {a.kind === "credit"
                  ? money(a.available ?? 0)
                  : money(a.balance, a.currency)}
              </div>
              {a.kind === "credit" && (
                <div style={{ color: "var(--text-faint)", fontSize: 11, marginTop: 2 }}>
                  доступно · долг {moneyShort(a.debt ?? 0)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * Кольцевая диаграмма с легендой. Цвет здесь — не единственный ключ: рядом
 * всегда есть название, сумма и доля, поэтому диаграмма читается и без цвета.
 */
function Donut({
  title,
  subtitle,
  data,
}: {
  title: string;
  subtitle: string;
  data: CategoryStat[];
}) {
  const TOP = 8;
  const top = data.slice(0, TOP);
  const tail = data.slice(TOP);
  const rows: CategoryStat[] = tail.length
    ? [
        ...top,
        {
          category_id: null,
          name: "Прочее",
          icon: "help-circle",
          color: FALLBACK,
          total: tail.reduce((s, c) => s + c.total, 0),
          count: tail.reduce((s, c) => s + c.count, 0),
        },
      ]
    : top;

  const total = rows.reduce((s, c) => s + c.total, 0);

  if (!rows.length) {
    return (
      <div className="card">
        <h2 style={{ fontSize: 14, marginBottom: 4 }}>{title}</h2>
        <div style={{ color: "var(--text-faint)", fontSize: 12 }}>{subtitle}</div>
        <div className="empty" style={{ padding: 40 }}>
          Нет данных за период
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: 14, marginBottom: 4 }}>{title}</h2>
      <div style={{ color: "var(--text-faint)", fontSize: 12, marginBottom: 10 }}>{subtitle}</div>

      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div style={{ width: 168, height: 168, flexShrink: 0, position: "relative" }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={rows}
                dataKey="total"
                nameKey="name"
                innerRadius={52}
                outerRadius={80}
                paddingAngle={2}
                stroke="var(--bg-panel)"
                strokeWidth={2}
              >
                {rows.map((c) => (
                  <Cell key={c.name} fill={c.color ?? FALLBACK} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number, n: string) => [
                  `${money(v)} · ${((v / total) * 100).toFixed(0)}%`,
                  n,
                ]}
              />
            </PieChart>
          </ResponsiveContainer>

          {/* Итог в центре кольца — то, ради чего сюда смотрят */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <div style={{ fontSize: 11, color: "var(--text-faint)" }}>всего</div>
            <div style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              {compact(total)} ₽
            </div>
          </div>
        </div>

        <div className="legend" style={{ flex: 1 }}>
          {rows.map((c) => (
            <div className="legend-item" key={c.name}>
              <span className="legend-dot" style={{ background: c.color ?? FALLBACK }} />
              <Icon name={c.icon} size={14} color="var(--text-faint)" />
              <span className="legend-name">{c.name}</span>
              <span className="legend-val">{compact(c.total)} ₽</span>
              <span className="legend-pct">{((c.total / total) * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Длина периода в днях; null — период не ограничен. */
function spanDays(r: Range): number | null {
  if (!r.from || !r.to) return null;
  const a = new Date(r.from).getTime();
  const b = new Date(r.to).getTime();
  return Math.round((b - a) / 86_400_000);
}
