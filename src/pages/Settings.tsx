import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, moneyShort } from "../api";
import Icon, { ICONS } from "../components/Icon";
import Modal from "../components/Modal";
import { useStore } from "../store";
import type { Category, CategoryKind, CategoryWithUsage } from "../types";

const COLORS = [
  "#E8833A", "#3D8BCD", "#7A62C9", "#4FB0C9", "#3FA9A0",
  "#A33B3B", "#C94FA0", "#B07CC6", "#35A877", "#E0A13C", "#8A8A8A",
];

export default function Settings() {
  const { reload, fail } = useStore();
  const [cats, setCats] = useState<CategoryWithUsage[]>([]);
  const [edit, setEdit] = useState<Partial<Category> | null>(null);
  const [removing, setRemoving] = useState<CategoryWithUsage | null>(null);

  const load = useCallback(async () => {
    try {
      setCats(await api.listCategoriesUsage());
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups: { kind: CategoryKind; title: string }[] = [
    { kind: "expense", title: "Категории расходов" },
    { kind: "income", title: "Категории доходов" },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Настройки</h1>
          <div className="sub">
            Переименование категории сразу отражается во всей истории операций
          </div>
        </div>
      </div>

      {groups.map((g) => {
        // Служебные категории (корректировки) редактировать нельзя — они
        // системные, поэтому в списке их нет.
        const list = cats.filter((c) => c.kind === g.kind && !c.parent_id && !c.is_service);
        return (
          <div key={g.kind} style={{ marginBottom: 26 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <h2 style={{ fontSize: 14, color: "var(--text-dim)" }}>{g.title}</h2>
              <button
                className="btn sm"
                onClick={() =>
                  setEdit({
                    id: 0,
                    name: "",
                    kind: g.kind,
                    icon: "help-circle",
                    color: COLORS[0],
                    sort: (list.length ? list[list.length - 1].sort : 0) + 10,
                  })
                }
              >
                <Plus size={14} />
                Категория
              </button>
            </div>

            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {list.map((c) => (
                <div className="cat-row" key={c.id}>
                  <span
                    className="cat-dot"
                    style={{ background: `${c.color}22`, color: c.color ?? "var(--text-dim)" }}
                  >
                    <Icon name={c.icon} size={17} />
                  </span>

                  <div className="cat-main">
                    <div className="nm">{c.name}</div>
                    {c.note && <div className="ds">{c.note}</div>}
                  </div>

                  <div
                    style={{
                      color: "var(--text-faint)",
                      fontSize: 12,
                      textAlign: "right",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.tx_count > 0 ? (
                      <>
                        {c.tx_count.toLocaleString("ru-RU")} оп.
                        <div style={{ fontVariantNumeric: "tabular-nums" }}>
                          {moneyShort(c.total)}
                        </div>
                      </>
                    ) : (
                      "не используется"
                    )}
                  </div>

                  <div className="row-actions">
                    <button className="btn ghost sm" onClick={() => setEdit(c)} title="Изменить">
                      <Pencil size={15} />
                    </button>
                    <button
                      className="btn ghost sm danger"
                      onClick={() => setRemoving(c)}
                      title="Удалить"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {edit && (
        <CategoryModal
          category={edit}
          onClose={() => setEdit(null)}
          onSaved={async () => {
            await Promise.all([load(), reload()]);
            setEdit(null);
          }}
        />
      )}

      {removing && (
        <DeleteModal
          category={removing}
          siblings={cats.filter(
            (c) => c.kind === removing.kind && c.id !== removing.id && !c.parent_id
          )}
          onClose={() => setRemoving(null)}
          onDone={async () => {
            await Promise.all([load(), reload()]);
            setRemoving(null);
          }}
        />
      )}
    </>
  );
}

function CategoryModal({
  category,
  onClose,
  onSaved,
}: {
  category: Partial<Category>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { fail } = useStore();
  const [c, setC] = useState<Partial<Category>>(category);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof Category>(k: K, v: Category[K]) => setC((p) => ({ ...p, [k]: v }));

  async function save() {
    if (!c.name?.trim()) return setErr("Введите название");
    setBusy(true);
    try {
      await api.saveCategory(c);
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
      title={c.id ? "Категория" : "Новая категория"}
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
      <div className="field">
        <label>Название</label>
        <input
          value={c.name ?? ""}
          onChange={(ev) => set("name", ev.target.value)}
          placeholder="Еда"
          autoFocus
        />
      </div>

      <div className="field">
        <label>Описание — что сюда относится</label>
        <input
          value={c.note ?? ""}
          onChange={(ev) => set("note", ev.target.value)}
          placeholder="Покупки в магазинах, заказы, рестораны"
        />
      </div>

      <div className="field">
        <label>Иконка</label>
        <div className="icon-grid">
          {Object.keys(ICONS).map((name) => (
            <button
              key={name}
              className={`icon-pick ${c.icon === name ? "on" : ""}`}
              onClick={() => set("icon", name)}
              title={name}
            >
              <Icon name={name} size={17} />
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Цвет</label>
        <div className="color-grid">
          {COLORS.map((col) => (
            <button
              key={col}
              className={`color-pick ${c.color === col ? "on" : ""}`}
              style={{ background: col }}
              onClick={() => set("color", col)}
            />
          ))}
        </div>
      </div>

      {c.id !== 0 && (
        <div style={{ color: "var(--text-faint)", fontSize: 12 }}>
          Переименование подхватится во всей истории — в операциях хранится ссылка на
          категорию, а не её название.
        </div>
      )}

      {err && <div style={{ color: "var(--red)", fontSize: 13 }}>{err}</div>}
    </Modal>
  );
}

function DeleteModal({
  category,
  siblings,
  onClose,
  onDone,
}: {
  category: CategoryWithUsage;
  siblings: CategoryWithUsage[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { fail } = useStore();
  const [moveTo, setMoveTo] = useState<number | "">(siblings[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  async function remove(withMove: boolean) {
    setBusy(true);
    try {
      await api.deleteCategory(category.id, withMove && moveTo !== "" ? moveTo : undefined);
      onDone();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const used = category.tx_count > 0;

  return (
    <Modal
      title={`Удалить «${category.name}»?`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          {used && (
            <button className="btn" onClick={() => remove(false)} disabled={busy}>
              Удалить и оставить без категории
            </button>
          )}
          <button className="btn primary" onClick={() => remove(used)} disabled={busy}>
            {used ? "Перенести и удалить" : "Удалить"}
          </button>
        </>
      }
    >
      {used ? (
        <>
          <div>
            В этой категории <b>{category.tx_count.toLocaleString("ru-RU")}</b> операций на{" "}
            <b>{moneyShort(category.total)}</b>. Операции не удалятся — выберите, куда их
            перенести.
          </div>
          <div className="field">
            <label>Перенести операции в</label>
            <select
              value={moveTo}
              onChange={(ev) => setMoveTo(ev.target.value ? Number(ev.target.value) : "")}
            >
              {siblings.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <div>Категория ни в одной операции не используется — удаление безопасно.</div>
      )}
    </Modal>
  );
}
