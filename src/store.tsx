import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, monthBounds } from "./api";
import { invalidate } from "./cache";
import { TopBar } from "./components/Loading";
import type { AccountWithBalance, Category, CreditWithBalance, ProjectWithStats } from "./types";

/**
 * Справочники (счета, категории, проекты, кредиты) нужны почти на каждой
 * странице и в форме операции. Держим их в одном месте и перезагружаем
 * целиком после любой правки — данных мало, а рассинхрон исключён.
 *
 * Здесь же живёт счётчик активных запросов: пока он больше нуля, вверху окна
 * идёт полоска загрузки. Без неё переключение страниц выглядело зависанием.
 */
interface Store {
  accounts: AccountWithBalance[];
  categories: Category[];
  projects: ProjectWithStats[];
  credits: CreditWithBalance[];
  loading: boolean;
  /** Идёт ли сейчас хоть один запрос — для индикатора. */
  busy: boolean;
  /** Обернуть загрузку, чтобы она попала в индикатор. */
  track: <T>(p: Promise<T>) => Promise<T>;
  reload: () => Promise<void>;
  fail: (err: unknown) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [credits, setCredits] = useState<CreditWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const warmed = useRef(false);

  const track = useCallback(<T,>(p: Promise<T>): Promise<T> => {
    setPending((n) => n + 1);
    return p.finally(() => setPending((n) => n - 1));
  }, []);

  const reload = useCallback(async () => {
    invalidate();
    try {
      const [a, c, p, cr] = await track(
        Promise.all([
          api.listAccounts(),
          api.listCategories(),
          api.listProjects(),
          api.listCredits(),
        ])
      );
      setAccounts(a);
      setCategories(c);
      setProjects(p);
      setCredits(cr);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [track]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Прогреваем то, что пользователь почти наверняка откроет следующим: первую
  // страницу журнала и сводку за текущий месяц. Вызовы идут через тот же api,
  // поэтому попадают в кэш под теми же ключами — и переход туда уже мгновенный.
  // В индикатор их не заводим: это фоновая работа, пользователь её не ждёт.
  useEffect(() => {
    if (loading || warmed.current) return;
    warmed.current = true;

    const [from, to] = monthBounds();
    const month = { from, to, net_refunds: true };
    const journal = { net_refunds: true };

    void Promise.allSettled([
      api.listTransactions({ ...journal, limit: 100, offset: 0 }),
      api.countTransactions(journal),
      api.summary(journal),
      api.categoryStats("expense", journal),
      api.summary(month),
      api.categoryStats("expense", month),
      api.categoryStats("income", month),
      api.netWorthSeries(month.from, month.to),
    ]);
  }, [loading]);

  const fail = useCallback((err: unknown) => setError(String(err)), []);

  // Ошибка сама уезжает через 4 секунды — отдельная кнопка «ок» тут лишняя.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  return (
    <Ctx.Provider
      value={{
        accounts,
        categories,
        projects,
        credits,
        loading,
        busy: pending > 0,
        track,
        reload,
        fail,
      }}
    >
      <TopBar active={pending > 0} />
      {children}
      {error && <div className="toast">{error}</div>}
    </Ctx.Provider>
  );
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore вызван вне StoreProvider");
  return s;
}
