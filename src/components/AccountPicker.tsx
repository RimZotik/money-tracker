import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { money } from "../api";
import type { AccountWithBalance } from "../types";
import { usePopover } from "./usePopover";

interface Props {
  accounts: AccountWithBalance[];
  /** Пустой массив означает «все счета». */
  value: number[];
  onChange: (ids: number[]) => void;
}

export default function AccountPicker({ accounts, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const popStyle = usePopover(box, pop, open);

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (box.current && !box.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const all = value.length === 0;
  const label = all
    ? "Все счета"
    : value.length === 1
      ? (accounts.find((a) => a.id === value[0])?.name ?? "1 счёт")
      : `Выбрано ${value.length}`;

  const toggle = (id: number) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="range" ref={box}>
      <button className={`btn range-btn ${open ? "on" : ""}`} onClick={() => setOpen((o) => !o)}>
        {label}
        <ChevronDown size={14} style={{ opacity: 0.6 }} />
      </button>

      {open && (
        <div className="acct-pop" ref={pop} style={popStyle}>
          <div className="acct-actions">
            <button className="btn ghost sm" onClick={() => onChange([])}>
              Все
            </button>
            <button
              className="btn ghost sm"
              onClick={() => onChange(accounts.map((a) => a.id))}
            >
              Выбрать все
            </button>
            <button className="btn ghost sm" onClick={() => onChange([-1])}>
              Снять все
            </button>
          </div>

          <div className="acct-list">
            {accounts.map((a) => {
              const on = all || value.includes(a.id);
              return (
                <button key={a.id} className="acct-item" onClick={() => toggle(a.id)}>
                  <span className={`acct-box ${on ? "on" : ""}`}>
                    {on && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className="acct-name">{a.name}</span>
                  <span className="acct-bal">
                    {a.kind === "credit" ? `−${money(a.debt ?? 0)}` : money(a.balance, a.currency)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
