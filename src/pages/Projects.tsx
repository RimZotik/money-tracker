import {
  Briefcase,
  Film,
  Gamepad2,
  Package,
  Pencil,
  Plus,
  Rocket,
  Smartphone,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { api, money } from "../api";
import Modal from "../components/Modal";
import { useStore } from "../store";
import type { Project, ProjectStatus } from "../types";

const KINDS: { v: string; label: string; icon: LucideIcon }[] = [
  { v: "youtube", label: "YouTube-канал", icon: Film },
  { v: "app", label: "Приложение", icon: Smartphone },
  { v: "game", label: "Игра", icon: Gamepad2 },
  { v: "freelance", label: "Заказ", icon: Briefcase },
  { v: "other", label: "Другое", icon: Package },
];

const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "В работе",
  paused: "На паузе",
  done: "Завершён",
};

const EMPTY: Partial<Project> = {
  id: 0,
  name: "",
  kind: "youtube",
  status: "active",
  started_at: new Date().toISOString().slice(0, 10),
};

export default function Projects() {
  const { projects, reload, fail } = useStore();
  const [edit, setEdit] = useState<Partial<Project> | null>(null);

  const totalProfit = projects.reduce((s, p) => s + p.profit, 0);

  async function remove(id: number) {
    if (!confirm("Удалить проект? Операции останутся, но потеряют привязку к нему.")) return;
    try {
      await api.deleteProject(id);
      await reload();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Проекты</h1>
          <div className="sub">
            {projects.length
              ? `Суммарно принесли ${money(totalProfit)}`
              : "Каналы, приложения, игры — всё, что приносит или ест деньги"}
          </div>
        </div>
        <button className="btn primary" onClick={() => setEdit({ ...EMPTY })}>
          <Plus size={16} />
          Проект
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="empty">
          <Rocket size={40} style={{ marginBottom: 12, opacity: 0.5 }} />
          <div>
            Проектов пока нет. Создайте проект — и в операциях сможете указывать,
            <br />
            на что именно потратились или откуда пришли деньги.
          </div>
        </div>
      ) : (
        <div className="grid cols-3">
          {projects.map((p) => {
            const kind = KINDS.find((k) => k.v === p.kind);
            const KindIcon = kind?.icon ?? Package;
            return (
            <div className="card" key={p.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                  <div style={{ marginTop: 5, display: "flex", gap: 5 }}>
                    <span className="badge">
                      <KindIcon size={13} />
                      {kind?.label ?? p.kind}
                    </span>
                    <span className="badge">{STATUS_LABELS[p.status]}</span>
                  </div>
                </div>
                <div className="row-actions" style={{ opacity: 1 }}>
                  <button className="btn ghost sm" onClick={() => setEdit(p)} title="Изменить">
                    <Pencil size={15} />
                  </button>
                  <button
                    className="btn ghost sm danger"
                    onClick={() => remove(p.id)}
                    title="Удалить"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {p.description && (
                <div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 10 }}>
                  {p.description}
                </div>
              )}

              <div className="stat" style={{ marginTop: 14 }}>
                <div className="label">Прибыль</div>
                <div className={`value ${p.profit > 0 ? "pos" : p.profit < 0 ? "neg" : ""}`}>
                  {money(p.profit)}
                </div>
                <div className="hint">
                  <span className="pos">+{money(p.income)}</span> ·{" "}
                  <span className="neg">−{money(p.expense)}</span> · {p.tx_count} оп.
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {edit && (
        <ProjectModal
          project={edit}
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

function ProjectModal({
  project,
  onClose,
  onSaved,
}: {
  project: Partial<Project>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { fail } = useStore();
  const [p, setP] = useState<Partial<Project>>(project);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof Project>(k: K, v: Project[K]) => setP((s) => ({ ...s, [k]: v }));

  async function save() {
    if (!p.name?.trim()) return setErr("Введите название");
    setBusy(true);
    try {
      await api.saveProject({ ...p, name: p.name.trim() });
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
      title={p.id ? "Проект" : "Новый проект"}
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
          <label>Название</label>
          <input
            value={p.name ?? ""}
            onChange={(ev) => set("name", ev.target.value)}
            placeholder="Основной YouTube-канал"
            autoFocus
          />
        </div>

        <div className="field">
          <label>Тип</label>
          <select value={p.kind ?? "other"} onChange={(ev) => set("kind", ev.target.value)}>
            {KINDS.map((k) => (
              <option key={k.v} value={k.v}>
                {k.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Статус</label>
          <select
            value={p.status}
            onChange={(ev) => set("status", ev.target.value as ProjectStatus)}
          >
            {(Object.keys(STATUS_LABELS) as ProjectStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="field full">
          <label>Описание</label>
          <textarea
            rows={3}
            value={p.description ?? ""}
            onChange={(ev) => set("description", ev.target.value)}
            placeholder="Что это за проект, чем занимаетесь"
          />
        </div>

        <div className="field">
          <label>Начат</label>
          <input
            type="date"
            value={p.started_at ?? ""}
            onChange={(ev) => set("started_at", ev.target.value)}
          />
        </div>

        <div className="field">
          <label>Завершён</label>
          <input
            type="date"
            value={p.closed_at ?? ""}
            onChange={(ev) => set("closed_at", ev.target.value)}
          />
        </div>
      </div>

      {err && <div style={{ color: "var(--red)", fontSize: 13 }}>{err}</div>}
    </Modal>
  );
}
