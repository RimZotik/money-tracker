import { invoke } from "@tauri-apps/api/core";
import { cached, invalidate } from "./cache";
import type {
  Account,
  AccountWithBalance,
  Category,
  CategoryStat,
  CategoryWithUsage,
  Credit,
  CreditWithBalance,
  PeriodStat,
  Project,
  ProjectWithStats,
  Summary,
  Transaction,
  TransactionRow,
  TxFilter,
} from "./types";

/** Ключ кэша: имя команды плюс её аргументы. */
const k = (name: string, args?: unknown) =>
  args === undefined ? name : `${name}:${JSON.stringify(args)}`;

/** Любая запись меняет данные, поэтому кэш чтения после неё недействителен. */
async function write<T>(p: Promise<T>): Promise<T> {
  const r = await p;
  invalidate();
  return r;
}

export const api = {
  // Счета
  listAccounts: (includeArchived = false) =>
    cached(k("accounts", includeArchived), () =>
      invoke<AccountWithBalance[]>("list_accounts", { includeArchived })
    ),
  saveAccount: (account: Partial<Account>) =>
    write(invoke<number>("save_account", { account: { id: 0, ...account } })),
  deleteAccount: (id: number) => write(invoke<void>("delete_account", { id })),
  /** Подогнать остаток счёта под фактический. Возвращает величину поправки. */
  adjustBalance: (accountId: number, actual: number, note?: string) =>
    write(invoke<number>("adjust_balance", { accountId, actual, note: note ?? null })),

  // Категории
  listCategories: () => cached(k("categories"), () => invoke<Category[]>("list_categories")),
  listCategoriesUsage: () =>
    cached(k("categoriesUsage"), () => invoke<CategoryWithUsage[]>("list_categories_usage")),
  saveCategory: (category: Partial<Category>) =>
    write(invoke<number>("save_category", { category: { id: 0, ...category } })),
  /** moveTo — куда перенести операции удаляемой категории (иначе они останутся без неё). */
  deleteCategory: (id: number, moveTo?: number) =>
    write(invoke<void>("delete_category", { id, moveTo: moveTo ?? null })),

  // Проекты
  listProjects: () => cached(k("projects"), () => invoke<ProjectWithStats[]>("list_projects")),
  saveProject: (project: Partial<Project>) =>
    write(invoke<number>("save_project", { project: { id: 0, ...project } })),
  deleteProject: (id: number) => write(invoke<void>("delete_project", { id })),

  // Кредиты
  listCredits: () => cached(k("credits"), () => invoke<CreditWithBalance[]>("list_credits")),
  saveCredit: (credit: Partial<Credit>) =>
    write(invoke<number>("save_credit", { credit: { id: 0, ...credit } })),
  deleteCredit: (id: number) => write(invoke<void>("delete_credit", { id })),

  // Операции
  listTransactions: (filter: TxFilter = {}) =>
    cached(k("tx", filter), () => invoke<TransactionRow[]>("list_transactions", { filter })),
  countTransactions: (filter: TxFilter = {}) =>
    cached(k("txCount", filter), () => invoke<number>("count_transactions", { filter })),
  saveTransaction: (tx: Partial<Transaction>) =>
    write(invoke<number>("save_transaction", { tx: { id: 0, ...tx } })),
  deleteTransaction: (id: number) => write(invoke<void>("delete_transaction", { id })),

  // Аналитика
  summary: (filter: TxFilter = {}) =>
    cached(k("summary", filter), () => invoke<Summary>("summary", { filter })),
  categoryStats: (kind: "income" | "expense", filter: TxFilter = {}) =>
    cached(k("catStats", [kind, filter]), () =>
      invoke<CategoryStat[]>("category_stats", { kind, filter })
    ),
  periodStats: (granularity: "day" | "month" | "year", filter: TxFilter = {}) =>
    cached(k("periodStats", [granularity, filter]), () =>
      invoke<PeriodStat[]>("period_stats", { granularity, filter })
    ),
  balanceAt: (accountId: number, at: string) =>
    cached(k("balanceAt", [accountId, at]), () =>
      invoke<number>("balance_at", { accountId, at })
    ),
  /** Капитал по дням: period = дата, income = капитал на эту дату. */
  netWorthSeries: (from?: string, to?: string) =>
    cached(k("netWorth", [from, to]), () =>
      invoke<PeriodStat[]>("net_worth_series", { from, to })
    ),
};

/** 12 345,67 ₽ */
export function money(v: number, currency = "RUB"): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(v);
}

/** 12 346 ₽ — без копеек, для крупных сумм. */
export function moneyShort(v: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(v);
}

/** 1 234 567 → «1,2 млн» — для подписей на осях. */
export function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} млн`;
  if (a >= 1000) return `${Math.round(v / 1000)}к`;
  return String(Math.round(v));
}

/** '2026-07-12 14:30:00' → '12 июл, 14:30' */
export function formatDateTime(iso: string): string {
  const d = new Date(iso.replace(" ", "T"));
  return d.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Локальное «сейчас» в формате, который понимает SQLite. */
export function nowLocal(): string {
  const d = new Date();
  return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

export const pad = (n: number) => String(n).padStart(2, "0");

/** Date → '2026-07-12' (в местном времени, без сдвига из-за UTC). */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Границы месяца: ['2026-07-01', '2026-07-31'] */
export function monthBounds(d = new Date()): [string, string] {
  const y = d.getFullYear();
  const m = d.getMonth();
  return [ymd(new Date(y, m, 1)), ymd(new Date(y, m + 1, 0))];
}

export const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

export const MONTHS_SHORT = [
  "янв", "фев", "мар", "апр", "май", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

/** '2026-07' → 'июл 2026', '2026-07-12' → '12 июл' */
export function formatPeriod(p: string): string {
  const parts = p.split("-");
  if (parts.length === 1) return p;
  if (parts.length === 2) return `${MONTHS_SHORT[+parts[1] - 1]} ${parts[0].slice(2)}`;
  return `${+parts[2]} ${MONTHS_SHORT[+parts[1] - 1]}`;
}
