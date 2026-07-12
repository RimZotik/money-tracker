import { useEffect, useMemo, useState } from "react";
import { api, nowLocal } from "../api";
import { useStore } from "../store";
import type { Transaction, TransactionRow, TxKind } from "../types";
import Modal from "./Modal";

interface Props {
  /** Если передана — редактируем, иначе создаём новую. */
  edit?: TransactionRow;
  initialKind?: TxKind;
  onClose: () => void;
  onSaved: () => void;
}

/** '2026-07-12 14:30:00' → ['2026-07-12', '14:30'] для двух инпутов. */
function splitDateTime(iso: string): [string, string] {
  const [d, t = "00:00:00"] = iso.split(" ");
  return [d, t.slice(0, 5)];
}

export default function TxModal({ edit, initialKind = "expense", onClose, onSaved }: Props) {
  const { accounts, categories, projects, credits, reload, fail } = useStore();

  const [kind, setKind] = useState<TxKind>(edit?.kind ?? initialKind);
  const [amount, setAmount] = useState(edit ? String(edit.amount) : "");
  const [date, setDate] = useState(() => splitDateTime(edit?.occurred_at ?? nowLocal())[0]);
  const [time, setTime] = useState(() => splitDateTime(edit?.occurred_at ?? nowLocal())[1]);
  const [accountId, setAccountId] = useState<number | "">(edit?.account_id ?? "");
  const [toAccountId, setToAccountId] = useState<number | "">(edit?.to_account_id ?? "");
  const [categoryId, setCategoryId] = useState<number | "">(edit?.category_id ?? "");
  const [projectId, setProjectId] = useState<number | "">(edit?.project_id ?? "");
  const [creditId, setCreditId] = useState<number | "">(edit?.credit_id ?? "");
  const [interest, setInterest] = useState(edit?.interest_part ? String(edit.interest_part) : "");
  const [counterparty, setCounterparty] = useState(edit?.counterparty ?? "");
  const [note, setNote] = useState(edit?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Первый счёт подставляем по умолчанию — чаще всего платят именно с него.
  useEffect(() => {
    if (!edit && accountId === "" && accounts.length) setAccountId(accounts[0].id);
  }, [accounts, edit, accountId]);

  const catList = useMemo(
    () => categories.filter((c) => c.kind === (kind === "income" ? "income" : "expense")),
    [categories, kind]
  );

  // Открытые кредиты и долги — только их есть смысл гасить.
  const openCredits = useMemo(
    () => credits.filter((c) => !c.closed_at && c.remaining > 0.01),
    [credits]
  );

  const amountNum = parseFloat(amount.replace(",", ".")) || 0;
  const interestNum = parseFloat(interest.replace(",", ".")) || 0;
  const isCreditPayment = kind === "expense" && creditId !== "";
  const principalPart = isCreditPayment ? Math.max(amountNum - interestNum, 0) : null;

  const selectedCredit = openCredits.find((c) => c.id === creditId);

  async function save() {
    setErr(null);
    if (amountNum <= 0) return setErr("Введите сумму");
    if (accountId === "") return setErr("Выберите счёт");
    if (kind === "transfer" && toAccountId === "") return setErr("Выберите счёт получателя");
    if (kind === "transfer" && toAccountId === accountId)
      return setErr("Счета отправителя и получателя совпадают");

    const tx: Partial<Transaction> = {
      id: edit?.id ?? 0,
      kind,
      occurred_at: `${date} ${time}:00`,
      amount: amountNum,
      account_id: accountId as number,
      to_account_id: kind === "transfer" ? (toAccountId as number) : null,
      // У погашения кредита своей категории нет: расходом являются только
      // проценты, и они попадают в «Проценты по кредиту» автоматически.
      category_id: kind === "transfer" ? null : categoryId === "" ? null : (categoryId as number),
      project_id: projectId === "" ? null : (projectId as number),
      credit_id: kind === "expense" && creditId !== "" ? (creditId as number) : null,
      principal_part: principalPart,
      interest_part: isCreditPayment ? interestNum : null,
      counterparty: counterparty.trim() || null,
      note: note.trim() || null,
    };

    setBusy(true);
    try {
      await api.saveTransaction(tx);
      await reload();
      onSaved();
      onClose();
    } catch (e2) {
      setErr(String(e2));
      fail(e2);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={edit ? "Операция" : "Новая операция"}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? "Сохраняю…" : "Сохранить"}
          </button>
        </>
      }
    >
      <div className="seg">
        {(["income", "expense", "transfer"] as TxKind[]).map((k) => (
          <button
            key={k}
            className={`${kind === k ? "on " + k : ""}`}
            onClick={() => {
              setKind(k);
              setCategoryId("");
              setCreditId("");
            }}
          >
            {k === "income" ? "Приход" : k === "expense" ? "Расход" : "Перевод"}
          </button>
        ))}
      </div>

      <div className="field">
        <label>Сумма</label>
        <input
          className="big"
          value={amount}
          onChange={(ev) => setAmount(ev.target.value)}
          placeholder="0,00"
          autoFocus
          inputMode="decimal"
        />
      </div>

      <div className="form-grid">
        <div className="field">
          <label>Дата</label>
          <input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} />
        </div>
        <div className="field">
          <label>Время</label>
          <input type="time" value={time} onChange={(ev) => setTime(ev.target.value)} />
        </div>

        <div className="field">
          <label>{kind === "income" ? "Куда" : kind === "transfer" ? "Откуда" : "С какого счёта"}</label>
          <select
            value={accountId}
            onChange={(ev) => setAccountId(ev.target.value ? Number(ev.target.value) : "")}
          >
            <option value="">— выберите —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        {kind === "transfer" ? (
          <div className="field">
            <label>Куда</label>
            <select
              value={toAccountId}
              onChange={(ev) => setToAccountId(ev.target.value ? Number(ev.target.value) : "")}
            >
              <option value="">— выберите —</option>
              {accounts
                .filter((a) => a.id !== accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </div>
        ) : (
          <div className="field">
            <label>Категория</label>
            <select
              value={categoryId}
              onChange={(ev) => setCategoryId(ev.target.value ? Number(ev.target.value) : "")}
              disabled={isCreditPayment}
            >
              <option value="">— без категории —</option>
              {catList
                .filter((c) => !c.parent_id)
                .map((parent) => {
                  const kids = catList.filter((c) => c.parent_id === parent.id);
                  return kids.length ? (
                    <optgroup key={parent.id} label={parent.name}>
                      <option value={parent.id}>{parent.name} — общее</option>
                      {kids.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : (
                    <option key={parent.id} value={parent.id}>
                      {parent.name}
                    </option>
                  );
                })}
            </select>
          </div>
        )}

        {/* Погашение кредита: только для расхода и только если есть что гасить */}
        {kind === "expense" && openCredits.length > 0 && (
          <div className="field full">
            <label>Погашение кредита или долга</label>
            <select
              value={creditId}
              onChange={(ev) => {
                const v = ev.target.value ? Number(ev.target.value) : "";
                setCreditId(v);
                if (v !== "") setCategoryId("");
              }}
            >
              <option value="">— обычный расход —</option>
              {openCredits.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — осталось {c.remaining.toLocaleString("ru-RU")} ₽
                </option>
              ))}
            </select>
          </div>
        )}

        {isCreditPayment && (
          <>
            <div className="field">
              <label>Из них проценты</label>
              <input
                value={interest}
                onChange={(ev) => setInterest(ev.target.value)}
                placeholder="0,00"
                inputMode="decimal"
              />
            </div>
            <div className="field">
              <label>Пойдёт на тело долга</label>
              <input value={(principalPart ?? 0).toLocaleString("ru-RU")} disabled />
            </div>
            {selectedCredit && principalPart !== null && (
              <div className="field full">
                <span className="hint" style={{ color: "var(--text-faint)", fontSize: 12 }}>
                  После платежа останется{" "}
                  <b className={selectedCredit.remaining - principalPart <= 0 ? "pos" : ""}>
                    {Math.max(selectedCredit.remaining - principalPart, 0).toLocaleString("ru-RU")} ₽
                  </b>
                  {selectedCredit.remaining - principalPart <= 0 && " — кредит закроется"}
                </span>
              </div>
            )}
          </>
        )}

        {kind !== "transfer" && projects.length > 0 && (
          <div className="field full">
            <label>Проект (необязательно)</label>
            <select
              value={projectId}
              onChange={(ev) => setProjectId(ev.target.value ? Number(ev.target.value) : "")}
            >
              <option value="">— без проекта —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {kind !== "transfer" && (
          <div className="field full">
            <label>{kind === "income" ? "От кого" : "Кому / где"}</label>
            <input
              value={counterparty}
              onChange={(ev) => setCounterparty(ev.target.value)}
              placeholder={kind === "income" ? "Работодатель, магазин…" : "Пятёрочка, DNS…"}
            />
          </div>
        )}

        <div className="field full">
          <label>Комментарий</label>
          <input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Необязательно" />
        </div>
      </div>

      {err && <div className="err" style={{ color: "var(--red)", fontSize: 13 }}>{err}</div>}
    </Modal>
  );
}
