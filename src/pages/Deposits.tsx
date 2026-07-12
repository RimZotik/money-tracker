import { Dices, Pencil, PiggyBank, Plus, Trash2, TrendingUp, Wallet } from "lucide-react";
import { useState } from "react";
import { api, money } from "../api";
import Modal from "../components/Modal";
import { useStore } from "../store";
import { DEPOSIT_TYPE_LABELS, type Account, type DepositType } from "../types";

const TYPE_ICON = {
  deposit: PiggyBank,
  invest: TrendingUp,
  betting: Dices,
  other: Wallet,
} as const satisfies Record<DepositType, unknown>;

const EMPTY: Partial<Account> = {
  id: 0,
  name: "",
  kind: "deposit",
  deposit_type: "deposit",
  currency: "RUB",
  opening_balance: 0,
  rate: 0,
};

/**
 * Вклады, брокерские счета и счета на ставках. Технически это те же счета
 * (kind='deposit'), поэтому деньги на них попадают обычным переводом, а остаток
 * считается из журнала — как у любого другого счёта.
 */
export default function Deposits() {
  const { accounts, reload, fail } = useStore();
  const [edit, setEdit] = useState<Partial<Account> | null>(null);

  const deposits = accounts.filter((a) => a.kind === "deposit");
  const total = deposits.reduce((s, a) => s + a.balance, 0);

  async function remove(id: number) {
    if (!confirm("Удалить? Операции по нему должны отсутствовать.")) return;
    try {
      await api.deleteAccount(id);
      await reload();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Вклады</h1>
          <div className="sub">
            {deposits.length
              ? `Вложено ${money(total)}`
              : "Вклады, инвестиции, счета на ставках"}
          </div>
        </div>
        <button className="btn primary" onClick={() => setEdit({ ...EMPTY })}>
          <Plus size={16} />
          Вклад
        </button>
      </div>

      {deposits.length === 0 ? (
        <div className="empty">
          <PiggyBank size={40} style={{ marginBottom: 12, opacity: 0.5 }} />
          <div>
            Вкладов нет. Заведите вклад, брокерский счёт или счёт на ставках —
            <br />
            пополнять его нужно обычным переводом, а остаток посчитается сам.
          </div>
        </div>
      ) : (
        <div className="grid cols-3">
          {deposits.map((a) => {
            const t = (a.deposit_type ?? "other") as DepositType;
            const TypeIcon = TYPE_ICON[t];
            return (
              <div className="card" key={a.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="cat" style={{ fontWeight: 600 }}>
                      <TypeIcon size={17} />
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {a.name}
                      </span>
                    </div>
                    <div style={{ marginTop: 6, display: "flex", gap: 5 }}>
                      <span className="badge">{DEPOSIT_TYPE_LABELS[t]}</span>
                      {a.org && <span className="badge">{a.org}</span>}
                    </div>
                  </div>
                  <div className="row-actions" style={{ opacity: 1 }}>
                    <button className="btn ghost sm" onClick={() => setEdit(a)} title="Изменить">
                      <Pencil size={15} />
                    </button>
                    <button
                      className="btn ghost sm danger"
                      onClick={() => remove(a.id)}
                      title="Удалить"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                <div className="stat" style={{ marginTop: 14 }}>
                  <div className="label">Сейчас на счёте</div>
                  <div className={`value ${a.balance < 0 ? "neg" : ""}`}>
                    {money(a.balance, a.currency)}
                  </div>
                  {a.rate ? <div className="hint">доходность {a.rate}% годовых</div> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {edit && (
        <DepositModal
          account={edit}
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

function DepositModal({
  account,
  onClose,
  onSaved,
}: {
  account: Partial<Account>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { fail } = useStore();
  const [a, setA] = useState<Partial<Account>>(account);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof Account>(k: K, v: Account[K]) => setA((p) => ({ ...p, [k]: v }));

  async function save() {
    if (!a.name?.trim()) return setErr("Введите название");
    setBusy(true);
    try {
      await api.saveAccount({ ...a, kind: "deposit", name: a.name.trim() });
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
      title={a.id ? "Вклад" : "Новый вклад"}
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
          <label>Что это</label>
          <select
            value={a.deposit_type ?? "deposit"}
            onChange={(ev) => set("deposit_type", ev.target.value as DepositType)}
          >
            {(Object.keys(DEPOSIT_TYPE_LABELS) as DepositType[]).map((k) => (
              <option key={k} value={k}>
                {DEPOSIT_TYPE_LABELS[k]}
              </option>
            ))}
          </select>
        </div>

        <div className="field full">
          <label>Название</label>
          <input
            value={a.name ?? ""}
            onChange={(ev) => set("name", ev.target.value)}
            placeholder="Вклад «Накопительный»"
            autoFocus
          />
        </div>

        <div className="field">
          <label>Банк или площадка</label>
          <input
            value={a.org ?? ""}
            onChange={(ev) => set("org", ev.target.value)}
            placeholder="Сбербанк, Т-Инвестиции…"
          />
        </div>

        <div className="field">
          <label>Доходность, % годовых</label>
          <input
            type="number"
            step="0.1"
            value={a.rate ?? ""}
            onChange={(ev) => set("rate", Number(ev.target.value))}
            placeholder="16"
          />
        </div>

        <div className="field">
          <label>Валюта</label>
          <select value={a.currency} onChange={(ev) => set("currency", ev.target.value)}>
            <option value="RUB">RUB — рубль</option>
            <option value="USD">USD — доллар</option>
            <option value="USDT">USDT</option>
          </select>
        </div>

        <div className="field">
          <label>Начальный остаток</label>
          <input
            type="number"
            value={a.opening_balance ?? 0}
            onChange={(ev) => set("opening_balance", Number(ev.target.value))}
          />
        </div>
      </div>

      {err && <div style={{ color: "var(--red)", fontSize: 13 }}>{err}</div>}
    </Modal>
  );
}
