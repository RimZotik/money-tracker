import {
  Check,
  CreditCard,
  Landmark,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { api, money } from "../api";
import Modal from "../components/Modal";
import { useStore } from "../store";
import { CREDIT_KIND_LABELS, type Credit, type CreditKind } from "../types";

const EMPTY: Partial<Credit> = {
  id: 0,
  name: "",
  kind: "loan",
  principal: 0,
  rate: 0,
  grace_days: 0,
  opened_at: new Date().toISOString().slice(0, 10),
};

/** Простая оценка переплаты по аннуитету — чтобы видеть цену кредита заранее. */
function annuity(principal: number, ratePct: number, months: number) {
  if (!principal || !months) return null;
  const m = ratePct / 100 / 12;
  const payment = m > 0 ? (principal * m) / (1 - Math.pow(1 + m, -months)) : principal / months;
  return { payment, total: payment * months, overpay: payment * months - principal };
}

export default function Credits() {
  const { credits, accounts, reload, fail } = useStore();
  const [edit, setEdit] = useState<Partial<Credit> | null>(null);

  // Кредитки живут в счетах, но показать долг по ним логичнее здесь же.
  const cards = accounts.filter((a) => a.kind === "credit");
  const activeCredits = credits.filter((c) => c.remaining > 0.01);
  const totalDebt =
    activeCredits.filter((c) => c.kind !== "lent").reduce((s, c) => s + c.remaining, 0) +
    cards.reduce((s, a) => s + (a.debt ?? 0), 0);
  const owedToMe = credits
    .filter((c) => c.kind === "lent" && c.remaining > 0.01)
    .reduce((s, c) => s + c.remaining, 0);

  async function remove(id: number) {
    if (!confirm("Удалить кредит? Платежи по нему станут обычными расходами.")) return;
    try {
      await api.deleteCredit(id);
      await reload();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Кредиты и долги</h1>
          <div className="sub">
            Всего должен {money(totalDebt)}
            {owedToMe > 0 && <> · мне должны {money(owedToMe)}</>}
          </div>
        </div>
        <button className="btn primary" onClick={() => setEdit({ ...EMPTY })}>
          <Plus size={16} />
          Кредит
        </button>
      </div>

      {cards.length > 0 && (
        <>
          <h2 style={{ fontSize: 14, color: "var(--text-dim)", margin: "0 0 10px" }}>
            Кредитные карты
          </h2>
          <div className="grid cols-3" style={{ marginBottom: 26 }}>
            {cards.map((a) => {
              const debt = a.debt ?? 0;
              return (
                <div className="card" key={a.id}>
                  <div className="cat" style={{ fontWeight: 600 }}>
                    <CreditCard size={17} />
                    {a.name}
                    {a.card_last4 && (
                      <span style={{ color: "var(--text-faint)" }}>···· {a.card_last4}</span>
                    )}
                  </div>
                  <div className="stat" style={{ marginTop: 12 }}>
                    <div className="label">Доступно</div>
                    <div className={`value ${(a.available ?? 0) > 0 ? "" : "neg"}`}>
                      {money(a.available ?? 0)}
                    </div>
                    <div className="hint">
                      Задолженность{" "}
                      <b className={debt > 0 ? "neg" : "pos"}>{money(debt)}</b> из лимита{" "}
                      {money(a.credit_limit ?? 0)}
                    </div>
                  </div>
                  {debt > 0 && a.grace_days ? (
                    <div
                      className="hint warn"
                      style={{ fontSize: 12, marginTop: 8, display: "flex", gap: 6 }}
                    >
                      <TriangleAlert size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>
                        Погасите в течение грейса ({a.grace_days} дн.), иначе набегут проценты по
                        ставке {a.rate}%
                      </span>
                    </div>
                  ) : null}
                  <div className="progress">
                    <div
                      style={{
                        width: `${Math.min((debt / (a.credit_limit || 1)) * 100, 100)}%`,
                        background: debt > 0 ? "var(--red)" : "var(--green)",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <h2 style={{ fontSize: 14, color: "var(--text-dim)", margin: "0 0 10px" }}>
        Кредиты и займы
      </h2>

      {credits.length === 0 ? (
        <div className="empty">
          <Landmark size={40} style={{ marginBottom: 12, opacity: 0.5 }} />
          <div>
            Кредитов нет. Возьмёте кредит на покупку — создайте его здесь,
            <br />и потом гасите, указывая в операции конкретный кредит.
          </div>
        </div>
      ) : (
        <div className="grid cols-2">
          {credits.map((c) => {
            const closed = c.remaining <= 0.01;
            return (
              <div className="card" key={c.id} style={{ opacity: closed ? 0.6 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    <div style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 3 }}>
                      <span className="badge">{CREDIT_KIND_LABELS[c.kind]}</span>{" "}
                      {c.org && <>· {c.org}</>} · с {c.opened_at}
                    </div>
                  </div>
                  <div className="row-actions" style={{ opacity: 1 }}>
                    <button className="btn ghost sm" onClick={() => setEdit(c)} title="Изменить">
                      <Pencil size={15} />
                    </button>
                    <button
                      className="btn ghost sm danger"
                      onClick={() => remove(c.id)}
                      title="Удалить"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                <div className="stat" style={{ marginTop: 14 }}>
                  <div className="label">{closed ? "Погашен" : "Осталось выплатить"}</div>
                  <div
                    className={`value ${closed ? "pos" : c.kind === "lent" ? "" : "neg"}`}
                    style={closed ? { display: "flex", alignItems: "center", gap: 6 } : undefined}
                  >
                    {closed ? (
                      <>
                        <Check size={20} />
                        {money(0)}
                      </>
                    ) : (
                      money(c.remaining)
                    )}
                  </div>
                  <div className="hint">
                    из {money(c.principal)}
                    {c.rate > 0 && ` · ${c.rate}% годовых`}
                    {c.grace_days > 0 && ` · грейс ${c.grace_days} дн.`}
                    {c.interest_paid > 0 && ` · процентов уплачено ${money(c.interest_paid)}`}
                  </div>
                </div>

                <div className="progress">
                  <div style={{ width: `${c.progress * 100}%` }} />
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-faint)",
                    marginTop: 6,
                    textAlign: "right",
                  }}
                >
                  погашено {Math.round(c.progress * 100)}%
                </div>
              </div>
            );
          })}
        </div>
      )}

      {edit && (
        <CreditModal
          credit={edit}
          onClose={() => setEdit(null)}
          onSaved={async () => {
            await reload();
            setEdit(null);
          }}
        />
      )}
    </>
  );
}

function CreditModal({
  credit,
  onClose,
  onSaved,
}: {
  credit: Partial<Credit>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { fail } = useStore();
  const [c, setC] = useState<Partial<Credit>>(credit);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof Credit>(k: K, v: Credit[K]) => setC((p) => ({ ...p, [k]: v }));

  const plan = annuity(c.principal ?? 0, c.rate ?? 0, c.term_months ?? 0);

  async function save() {
    if (!c.name?.trim()) return setErr("Введите название");
    if (!c.principal || c.principal <= 0) return setErr("Введите сумму");
    setBusy(true);
    try {
      await api.saveCredit({ ...c, name: c.name.trim() });
      onSaved();
    } catch (e) {
      setErr(String(e));
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={c.id ? "Кредит" : "Новый кредит"}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            Сохранить
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field full">
          <label>Тип</label>
          <select value={c.kind} onChange={(ev) => set("kind", ev.target.value as CreditKind)}>
            {(Object.keys(CREDIT_KIND_LABELS) as CreditKind[]).map((k) => (
              <option key={k} value={k}>
                {CREDIT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>

        <div className="field full">
          <label>Название</label>
          <input
            value={c.name ?? ""}
            onChange={(ev) => set("name", ev.target.value)}
            placeholder="Кредит на ноутбук"
            autoFocus
          />
        </div>

        <div className="field">
          <label>{c.kind === "loan" ? "Банк" : "Кто / кому"}</label>
          <input
            value={c.org ?? ""}
            onChange={(ev) => set("org", ev.target.value)}
            placeholder={c.kind === "loan" ? "Сбербанк" : "Имя"}
          />
        </div>

        <div className="field">
          <label>Сумма</label>
          <input
            type="number"
            value={c.principal || ""}
            onChange={(ev) => set("principal", Number(ev.target.value))}
            placeholder="70870"
          />
        </div>

        <div className="field">
          <label>Ставка, % годовых</label>
          <input
            type="number"
            step="0.1"
            value={c.rate || ""}
            onChange={(ev) => set("rate", Number(ev.target.value))}
            placeholder="27.6"
          />
        </div>

        <div className="field">
          <label>Беспроцентный период, дней</label>
          <input
            type="number"
            value={c.grace_days || ""}
            onChange={(ev) => set("grace_days", Number(ev.target.value))}
            placeholder="120"
          />
        </div>

        <div className="field">
          <label>Дата оформления</label>
          <input
            type="date"
            value={c.opened_at ?? ""}
            onChange={(ev) => set("opened_at", ev.target.value)}
          />
        </div>

        <div className="field">
          <label>Срок, месяцев</label>
          <input
            type="number"
            value={c.term_months ?? ""}
            onChange={(ev) => set("term_months", Number(ev.target.value))}
            placeholder="12"
          />
        </div>

        {plan && (
          <div className="field full">
            <div
              className="card"
              style={{ background: "var(--bg)", fontSize: 13, lineHeight: 1.7 }}
            >
              Платёж <b>{money(plan.payment)}</b> в месяц · всего отдадите{" "}
              <b>{money(plan.total)}</b> · переплата{" "}
              <b className="warn">{money(plan.overpay)}</b>
            </div>
          </div>
        )}

        <div className="field full">
          <label>Заметка</label>
          <input
            value={c.note ?? ""}
            onChange={(ev) => set("note", ev.target.value)}
            placeholder="На что взят"
          />
        </div>
      </div>

      {err && <div style={{ color: "var(--red)", fontSize: 13 }}>{err}</div>}
    </Modal>
  );
}
