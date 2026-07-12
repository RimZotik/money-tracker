import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Landmark,
  List,
  Pencil,
  Rocket,
  Trash2,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { api, compact, formatDateTime, money, moneyShort } from "../api";
import AccountPicker from "../components/AccountPicker";
import DateRangePicker, { type Range } from "../components/DateRangePicker";
import Icon from "../components/Icon";
import { TableSkeleton } from "../components/Loading";
import TxModal from "../components/TxModal";
import { useStore } from "../store";
import {
  TX_KIND_LABELS,
  type CategoryStat,
  type Summary,
  type TransactionRow,
  type TxFilter,
  type TxKind,
} from "../types";

const PAGE = 100;
const FALLBACK = "#7C8398";

export default function Transactions() {
  const { accounts, categories, reload, fail, track } = useStore();

  const [range, setRange] = useState<Range>({});
  const [acctIds, setAcctIds] = useState<number[]>([]);
  const [kind, setKind] = useState<TxKind | "">("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [search, setSearch] = useState("");
  const [net, setNet] = useState(true);

  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState<TransactionRow | null>(null);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [sum, setSum] = useState<Summary | null>(null);
  const [cats, setCats] = useState<CategoryStat[]>([]);

  // Собираем фильтр в том виде, в каком его ждёт бэкенд
  const filter: TxFilter = {
    from: range.from,
    to: range.to,
    account_ids: acctIds.length ? acctIds : undefined,
    kind: kind || undefined,
    category_id: categoryId === "" ? undefined : categoryId,
    search: search.trim() || undefined,
    net_refunds: net,
  };
  const key = JSON.stringify(filter);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const f: TxFilter = JSON.parse(key);
      const [list, count, s, c] = await track(
        Promise.all([
          api.listTransactions({ ...f, limit: PAGE, offset: page * PAGE }),
          api.countTransactions(f),
          api.summary(f),
          api.categoryStats("expense", f),
        ])
      );
      setRows(list);
      setTotal(count);
      setSum(s);
      setCats(c);
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }, [key, page, fail, track]);

  useEffect(() => {
    void load();
  }, [load]);

  // Любая смена фильтра возвращает на первую страницу — иначе можно оказаться
  // на пятой странице результата, где всего две строки.
  useEffect(() => {
    setPage(0);
  }, [key]);

  async function remove(row: TransactionRow) {
    if (!confirm(`Удалить операцию на ${money(row.amount)}?`)) return;
    try {
      await api.deleteTransaction(row.id);
      await Promise.all([load(), reload()]);
    } catch (e) {
      fail(e);
    }
  }

  const pages = Math.ceil(total / PAGE);
  const dirty =
    !!range.from || !!range.to || acctIds.length > 0 || !!kind || categoryId !== "" || !!search;

  const topCats = cats.slice(0, 6);
  const catTotal = cats.reduce((s, c) => s + c.total, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Операции</h1>
          <div className="sub">{total.toLocaleString("ru-RU")} в журнале по фильтру</div>
        </div>
        <label className="switch" title="Возврат гасит исходный расход, а не считается доходом">
          <input type="checkbox" checked={net} onChange={(ev) => setNet(ev.target.checked)} />
          Зачитывать возвраты
        </label>
      </div>

      <div className="filters">
        <DateRangePicker value={range} onChange={setRange} />
        <AccountPicker accounts={accounts} value={acctIds} onChange={setAcctIds} />

        <div className="field">
          <select value={kind} onChange={(ev) => setKind(ev.target.value as TxKind | "")}>
            <option value="">Любой тип</option>
            <option value="income">Приход</option>
            <option value="expense">Расход</option>
            <option value="transfer">Перевод</option>
          </select>
        </div>

        <div className="field">
          <select
            value={categoryId}
            onChange={(ev) => setCategoryId(ev.target.value ? Number(ev.target.value) : "")}
          >
            <option value="">Все категории</option>
            {categories
              .filter((c) => !c.parent_id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>

        <div className="field" style={{ flex: 1, minWidth: 170 }}>
          <input
            value={search}
            onChange={(ev) => setSearch(ev.target.value)}
            placeholder="Поиск по магазину или комментарию"
          />
        </div>

        {dirty && (
          <button
            className="btn ghost"
            onClick={() => {
              setRange({});
              setAcctIds([]);
              setKind("");
              setCategoryId("");
              setSearch("");
            }}
          >
            Сбросить
          </button>
        )}
      </div>

      {/* Сводка ровно по тому, что сейчас в фильтре */}
      {sum && (
        <div className="rollup">
          <button className="rollup-head" onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <div className="rollup-quick">
              <div>
                <div className="k">Доход</div>
                <div className="v pos">{moneyShort(sum.income)}</div>
              </div>
              <div>
                <div className="k">Расход</div>
                <div className="v neg">{moneyShort(sum.expense)}</div>
              </div>
              <div>
                <div className="k">Итого</div>
                <div className={`v ${sum.profit >= 0 ? "pos" : "neg"}`}>
                  {moneyShort(sum.profit)}
                </div>
              </div>
              {sum.refunded > 0 && (
                <div>
                  <div className="k">Возвраты</div>
                  <div className="v">{moneyShort(sum.refunded)}</div>
                </div>
              )}
              <div>
                <div className="k">Операций</div>
                <div className="v">{sum.tx_count.toLocaleString("ru-RU")}</div>
              </div>
            </div>
            <span style={{ color: "var(--text-faint)", fontSize: 12 }}>
              {open ? "свернуть" : "подробнее"}
            </span>
          </button>

          {open && (
            <div className="rollup-body">
              {topCats.length === 0 ? (
                <div className="empty" style={{ padding: 24 }}>
                  Расходов по этому фильтру нет
                </div>
              ) : (
                <div style={{ display: "flex", gap: 20, alignItems: "center", paddingTop: 14 }}>
                  <div style={{ width: 150, height: 150, flexShrink: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={topCats}
                          dataKey="total"
                          nameKey="name"
                          innerRadius={45}
                          outerRadius={72}
                          paddingAngle={2}
                          stroke="var(--bg-panel)"
                          strokeWidth={2}
                        >
                          {topCats.map((c) => (
                            <Cell key={c.name} fill={c.color ?? FALLBACK} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: "#21252f",
                            border: "1px solid #2e3340",
                            borderRadius: 8,
                            color: "#e6e8ee",
                            fontSize: 13,
                          }}
                          formatter={(v: number, n: string) => [money(v), n]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="legend" style={{ flex: 1 }}>
                    {topCats.map((c) => (
                      <div className="legend-item" key={c.name}>
                        <span className="legend-dot" style={{ background: c.color ?? FALLBACK }} />
                        <Icon name={c.icon} size={14} color="var(--text-faint)" />
                        <span className="legend-name">{c.name}</span>
                        <span className="legend-val">{compact(c.total)} ₽</span>
                        <span className="legend-pct">
                          {catTotal ? ((c.total / catTotal) * 100).toFixed(0) : 0}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 130 }}>Когда</th>
              <th style={{ width: 90 }}>Тип</th>
              <th>Категория / куда</th>
              <th>Описание</th>
              <th style={{ width: 150 }}>Счёт</th>
              <th className="num" style={{ width: 130 }}>
                Сумма
              </th>
              <th style={{ width: 70 }} />
            </tr>
          </thead>

          {/* Пока строк ещё нет — скелет; когда есть — глушим старые, но не
              выкидываем: так таблица не мигает пустотой при смене фильтра. */}
          {loading && rows.length === 0 && <TableSkeleton rows={10} />}

          <tbody className={loading && rows.length > 0 ? "stale" : undefined}>
            {rows.map((r) => (
              <tr key={r.id} onDoubleClick={() => setEdit(r)}>
                <td style={{ color: "var(--text-dim)" }}>{formatDateTime(r.occurred_at)}</td>
                <td>
                  <span className={`badge ${r.kind}`}>
                    {r.is_refund ? "Возврат" : TX_KIND_LABELS[r.kind]}
                  </span>
                </td>
                <td>
                  {r.kind === "transfer" ? (
                    <span className="cat" style={{ color: "var(--text-dim)" }}>
                      <ArrowRight size={14} />
                      {r.to_account_name}
                    </span>
                  ) : r.is_refund ? (
                    <span className="cat" style={{ color: "var(--text-dim)" }}>
                      <Undo2 size={14} />
                      возврат покупки
                    </span>
                  ) : r.credit_name ? (
                    <span className="badge">
                      <Landmark size={13} />
                      {r.credit_name}
                    </span>
                  ) : r.category_name ? (
                    <span className="cat">
                      <Icon
                        name={r.category_icon}
                        size={15}
                        color={r.category_color ?? undefined}
                      />
                      {r.category_name}
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-faint)" }}>—</span>
                  )}
                  {r.project_name && (
                    <span className="badge" style={{ marginLeft: 6 }}>
                      <Rocket size={13} />
                      {r.project_name}
                    </span>
                  )}
                </td>
                <td
                  style={{
                    color: "var(--text-dim)",
                    maxWidth: 260,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={r.counterparty ?? r.note ?? ""}
                >
                  {r.counterparty ?? r.note ?? ""}
                </td>
                <td style={{ color: "var(--text-dim)" }}>{r.account_name}</td>
                <td
                  className={`num ${r.kind === "income" ? "pos" : r.kind === "expense" ? "neg" : ""}`}
                  style={{ fontWeight: 600 }}
                >
                  {r.kind === "income" ? "+" : r.kind === "expense" ? "−" : ""}
                  {money(r.amount)}
                  {r.interest_part ? (
                    <div style={{ fontSize: 11, color: "var(--amber)", fontWeight: 400 }}>
                      % {money(r.interest_part)}
                    </div>
                  ) : null}
                </td>
                <td>
                  <div className="row-actions">
                    <button className="btn ghost sm" onClick={() => setEdit(r)} title="Изменить">
                      <Pencil size={15} />
                    </button>
                    <button
                      className="btn ghost sm danger"
                      onClick={() => remove(r)}
                      title="Удалить"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!loading && rows.length === 0 && (
          <div className="empty">
            <List size={40} style={{ marginBottom: 12, opacity: 0.5 }} />
            <div>Операций не найдено</div>
          </div>
        )}
      </div>

      {pages > 1 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "center",
            alignItems: "center",
            marginTop: 16,
          }}
        >
          <button className="btn sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            ← Назад
          </button>
          <span style={{ color: "var(--text-faint)", fontSize: 13 }}>
            {page + 1} из {pages}
          </span>
          <button
            className="btn sm"
            disabled={page >= pages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            Вперёд →
          </button>
        </div>
      )}

      {edit && (
        <TxModal
          edit={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            void load();
          }}
        />
      )}
    </>
  );
}
