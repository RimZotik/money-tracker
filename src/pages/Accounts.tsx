import {
  Banknote,
  Bitcoin,
  CreditCard,
  Landmark,
  Pencil,
  PiggyBank,
  Plus,
  Scale,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { api, money } from "../api";
import Modal from "../components/Modal";
import { useStore } from "../store";
import {
  ACCOUNT_KIND_LABELS,
  type Account,
  type AccountKind,
  type AccountWithBalance,
} from "../types";

const KIND_ICON = {
  bank: Landmark,
  credit: CreditCard,
  crypto: Bitcoin,
  cash: Banknote,
  deposit: PiggyBank,
} as const satisfies Record<AccountKind, unknown>;

const EMPTY: Partial<Account> = {
  id: 0,
  name: "",
  kind: "bank",
  currency: "RUB",
  opening_balance: 0,
  archived: false,
};

export default function Accounts() {
  const { accounts: all, reload, fail } = useStore();
  const [edit, setEdit] = useState<Partial<Account> | null>(null);
  const [adjusting, setAdjusting] = useState<AccountWithBalance | null>(null);

  // Вклады и брокерские счета живут на своей странице
  const accounts = all.filter((a) => a.kind !== "deposit");

  const total = accounts
    .filter((a) => a.kind !== "credit")
    .reduce((s, a) => s + a.balance, 0);
  const debt = accounts.reduce((s, a) => s + (a.debt ?? 0), 0);

  async function remove(id: number) {
    if (!confirm("Удалить счёт? Операции по нему должны отсутствовать.")) return;
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
          <h1>Счета</h1>
          <div className="sub">
            Своих денег {money(total)}
            {debt > 0 && <> · долг по картам {money(debt)}</>}
          </div>
        </div>
        <button className="btn primary" onClick={() => setEdit({ ...EMPTY })}>
          <Plus size={16} />
          Счёт
        </button>
      </div>

      {accounts.length === 0 ? (
        <div className="empty">
          <CreditCard size={40} style={{ marginBottom: 12, opacity: 0.5 }} />
          <div>
            Ни одного счёта. Добавьте карту, кошелёк или наличные — <br />
            дальше операции сами начнут считать остатки.
          </div>
        </div>
      ) : (
        <div className="grid cols-3">
          {accounts.map((a) => {
            const KindIcon = KIND_ICON[a.kind];
            return (
            <div className="card" key={a.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, display: "flex", gap: 7, alignItems: "center" }}>
                    <KindIcon size={17} />
                    <span
                      style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {a.name}
                    </span>
                  </div>
                  <div style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 3 }}>
                    {a.org ?? ACCOUNT_KIND_LABELS[a.kind]}
                    {a.card_last4 && ` ···· ${a.card_last4}`}
                  </div>
                </div>
                <div className="row-actions" style={{ opacity: 1 }}>
                  <button
                    className="btn ghost sm"
                    onClick={() => setAdjusting(a)}
                    title="Скорректировать остаток"
                  >
                    <Scale size={15} />
                  </button>
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

              {a.kind === "credit" ? (
                <>
                  {/* Главная цифра у кредитки — сколько можно потратить.
                      Задолженность стоит рядом: она показывает, сколько из
                      лимита уже взято. */}
                  <div className="stat" style={{ marginTop: 14 }}>
                    <div className="label">Доступно</div>
                    <div className={`value ${(a.available ?? 0) > 0 ? "" : "neg"}`}>
                      {money(a.available ?? 0)}
                    </div>
                    <div className="hint">
                      Взято{" "}
                      <b className={(a.debt ?? 0) > 0 ? "neg" : "pos"}>{money(a.debt ?? 0)}</b> из
                      лимита {money(a.credit_limit ?? 0)}
                      {a.rate ? ` · ${a.rate}% годовых` : ""}
                      {a.grace_days ? ` · грейс ${a.grace_days} дн.` : ""}
                    </div>
                  </div>
                  <div className="progress">
                    <div
                      style={{
                        width: `${Math.min(
                          ((a.debt ?? 0) / (a.credit_limit || 1)) * 100,
                          100
                        )}%`,
                        background: (a.debt ?? 0) > 0 ? "var(--red)" : "var(--green)",
                      }}
                    />
                  </div>
                </>
              ) : (
                <div className="stat" style={{ marginTop: 14 }}>
                  <div className="label">Остаток</div>
                  <div className={`value ${a.balance < 0 ? "neg" : ""}`}>
                    {money(a.balance, a.currency)}
                  </div>
                  {a.number && (
                    <div
                      className="hint"
                      style={{
                        fontFamily: "monospace",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {a.number}
                    </div>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {edit && (
        <AccountModal
          account={edit}
          onClose={() => setEdit(null)}
          onSaved={async () => {
            await reload();
            setEdit(null);
          }}
        />
      )}

      {adjusting && (
        <AdjustModal
          account={adjusting}
          onClose={() => setAdjusting(null)}
          onDone={async () => {
            await reload();
            setAdjusting(null);
          }}
        />
      )}
    </>
  );
}

/**
 * Корректировка остатка. Если приложение показывает не то, что банк, разницу
 * закрывает служебная операция — она не видна в журнале и не портит аналитику,
 * но остаток после неё сходится.
 */
function AdjustModal({
  account,
  onClose,
  onDone,
}: {
  account: AccountWithBalance;
  onClose: () => void;
  onDone: () => void;
}) {
  const { fail } = useStore();
  // У кредитки в приложении хранится долг со знаком минус, а человек мыслит
  // долгом как положительным числом.
  const isCredit = account.kind === "credit";
  const current = isCredit ? (account.debt ?? 0) : account.balance;

  const [value, setValue] = useState(String(current));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const entered = parseFloat(value.replace(",", ".").replace(/\s/g, ""));
  const valid = !Number.isNaN(entered);
  const diff = valid ? entered - current : 0;

  async function apply() {
    if (!valid) return setErr("Введите сумму");
    setBusy(true);
    try {
      // Для кредитки долг d означает баланс счёта −d
      await api.adjustBalance(account.id, isCredit ? -entered : entered);
      onDone();
    } catch (e) {
      setErr(String(e));
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Корректировка: ${account.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn primary"
            onClick={apply}
            disabled={busy || !valid || Math.abs(diff) < 0.01}
          >
            Скорректировать
          </button>
        </>
      }
    >
      <div style={{ color: "var(--text-dim)", fontSize: 13 }}>
        Приложение считает остаток из операций. Если банк показывает другое число —
        впишите его, и разница закроется служебной операцией. В журнале операций она
        не появится.
      </div>

      <div className="form-grid">
        <div className="field">
          <label>{isCredit ? "Долг сейчас (по расчёту)" : "Остаток сейчас (по расчёту)"}</label>
          <input value={money(current)} disabled />
        </div>
        <div className="field">
          <label>{isCredit ? "Долг по данным банка" : "Остаток по данным банка"}</label>
          <input
            value={value}
            onChange={(ev) => setValue(ev.target.value)}
            inputMode="decimal"
            autoFocus
          />
        </div>
      </div>

      {valid && Math.abs(diff) >= 0.01 && (
        <div className="card" style={{ background: "var(--bg)", fontSize: 13 }}>
          Будет создана операция на{" "}
          <b className={diff > 0 ? "pos" : "neg"}>
            {diff > 0 ? "+" : "−"}
            {money(Math.abs(diff))}
          </b>
          {isCredit && " (долг изменится в обратную сторону)"}
        </div>
      )}

      {err && <div style={{ color: "var(--red)", fontSize: 13 }}>{err}</div>}
    </Modal>
  );
}

function AccountModal({
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
  const isCrypto = a.kind === "crypto";
  const isCredit = a.kind === "credit";
  const isCash = a.kind === "cash";

  async function save() {
    if (!a.name?.trim()) return setErr("Введите название");
    setBusy(true);
    try {
      await api.saveAccount({ ...a, name: a.name.trim() });
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
      title={a.id ? "Счёт" : "Новый счёт"}
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
          <label>Тип счёта</label>
          <select
            value={a.kind}
            onChange={(ev) => set("kind", ev.target.value as AccountKind)}
          >
            {/* Вклады заводятся на своей странице — здесь их нет */}
            {(["bank", "credit", "crypto", "cash"] as AccountKind[]).map((k) => (
              <option key={k} value={k}>
                {ACCOUNT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>

        <div className="field full">
          <label>Название</label>
          <input
            value={a.name ?? ""}
            onChange={(ev) => set("name", ev.target.value)}
            placeholder={isCrypto ? "Основной кошелёк" : "Дебетовая Сбер"}
            autoFocus
          />
        </div>

        {!isCash && (
          <div className="field">
            <label>{isCrypto ? "Сеть или биржа" : "Банк"}</label>
            <input
              value={a.org ?? ""}
              onChange={(ev) => set("org", ev.target.value)}
              placeholder={isCrypto ? "TON, Binance…" : "Сбербанк"}
            />
          </div>
        )}

        {!isCash && !isCrypto && (
          <div className="field">
            <label>Последние 4 цифры карты</label>
            <input
              value={a.card_last4 ?? ""}
              onChange={(ev) => set("card_last4", ev.target.value.slice(0, 4))}
              placeholder="1510"
              maxLength={4}
            />
          </div>
        )}

        {!isCash && (
          <div className="field full">
            <label>{isCrypto ? "Адрес кошелька" : "Номер счёта"}</label>
            <input
              value={a.number ?? ""}
              onChange={(ev) => set("number", ev.target.value)}
              placeholder={isCrypto ? "UQD…" : "40817810027008243707"}
              style={{ fontFamily: "monospace" }}
            />
          </div>
        )}

        {isCredit && (
          <>
            <div className="field">
              <label>Кредитный лимит</label>
              <input
                type="number"
                value={a.credit_limit ?? ""}
                onChange={(ev) => set("credit_limit", Number(ev.target.value))}
                placeholder="115000"
              />
            </div>
            <div className="field">
              <label>Ставка, % годовых</label>
              <input
                type="number"
                step="0.1"
                value={a.rate ?? ""}
                onChange={(ev) => set("rate", Number(ev.target.value))}
                placeholder="27.6"
              />
            </div>
            <div className="field full">
              <label>Беспроцентный период, дней</label>
              <input
                type="number"
                value={a.grace_days ?? ""}
                onChange={(ev) => set("grace_days", Number(ev.target.value))}
                placeholder="120"
              />
            </div>
          </>
        )}

        <div className="field">
          <label>Валюта</label>
          <select value={a.currency} onChange={(ev) => set("currency", ev.target.value)}>
            <option value="RUB">RUB — рубль</option>
            <option value="USD">USD — доллар</option>
            <option value="EUR">EUR — евро</option>
            <option value="USDT">USDT</option>
            <option value="BTC">BTC</option>
            <option value="TON">TON</option>
          </select>
        </div>

        {!isCredit && (
          <div className="field">
            <label>Начальный остаток</label>
            <input
              type="number"
              value={a.opening_balance ?? 0}
              onChange={(ev) => set("opening_balance", Number(ev.target.value))}
            />
          </div>
        )}

        {a.id !== 0 && (
          <div className="field full">
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={!!a.archived}
                onChange={(ev) => set("archived", ev.target.checked)}
              />
              В архиве — счёт закрыт, скрыть из списков
            </label>
          </div>
        )}
      </div>

      {err && <div style={{ color: "var(--red)", fontSize: 13 }}>{err}</div>}
    </Modal>
  );
}
