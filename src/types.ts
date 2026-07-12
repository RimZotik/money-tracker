export type AccountKind = "bank" | "credit" | "crypto" | "cash" | "deposit";
export type DepositType = "deposit" | "invest" | "betting" | "other";
export type TxKind = "income" | "expense" | "transfer";
export type CategoryKind = "income" | "expense";
export type CreditKind = "loan" | "debt" | "lent";
export type ProjectStatus = "active" | "paused" | "done";

export interface Account {
  id: number;
  name: string;
  kind: AccountKind;
  org: string | null;
  number: string | null;
  card_last4: string | null;
  currency: string;
  opening_balance: number;
  opened_at: string | null;
  credit_limit: number | null;
  rate: number | null;
  grace_days: number | null;
  deposit_type: DepositType | null;
  color: string | null;
  archived: boolean;
}

export interface AccountWithBalance extends Account {
  balance: number;
  /** Только для кредитки: сколько лимита осталось. */
  available: number | null;
  /** Только для кредитки: текущий долг, положительное число. */
  debt: number | null;
}

export interface Category {
  id: number;
  name: string;
  kind: CategoryKind;
  parent_id: number | null;
  icon: string | null;
  color: string | null;
  note: string | null;
  /** Служебная категория (корректировка остатка) — скрыта из журнала и аналитики. */
  is_service: boolean;
  sort: number;
}

export interface CategoryWithUsage extends Category {
  tx_count: number;
  total: number;
}

export interface Project {
  id: number;
  name: string;
  kind: string | null;
  description: string | null;
  status: ProjectStatus;
  started_at: string | null;
  closed_at: string | null;
  color: string | null;
}

export interface ProjectWithStats extends Project {
  income: number;
  expense: number;
  profit: number;
  tx_count: number;
}

export interface Credit {
  id: number;
  name: string;
  kind: CreditKind;
  org: string | null;
  principal: number;
  rate: number;
  grace_days: number;
  term_months: number | null;
  opened_at: string;
  closed_at: string | null;
  note: string | null;
}

export interface CreditWithBalance extends Credit {
  remaining: number;
  interest_paid: number;
  progress: number;
}

export interface Transaction {
  id: number;
  kind: TxKind;
  occurred_at: string;
  amount: number;
  account_id: number | null;
  to_account_id: number | null;
  category_id: number | null;
  project_id: number | null;
  credit_id: number | null;
  principal_part: number | null;
  interest_part: number | null;
  counterparty: string | null;
  note: string | null;
  is_refund: boolean;
  refund_of: number | null;
  ext_id: string | null;
  source: string;
}

export interface TransactionRow extends Transaction {
  account_name: string | null;
  to_account_name: string | null;
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
  project_name: string | null;
  credit_name: string | null;
}

export interface TxFilter {
  from?: string;
  to?: string;
  kind?: TxKind;
  /** Пусто или не задано — все счета. */
  account_ids?: number[];
  category_id?: number;
  project_id?: number;
  credit_id?: number;
  search?: string;
  /** Возврат гасит исходный расход, а не считается доходом. */
  net_refunds?: boolean;
  /** Показывать служебные операции (корректировки остатка). По умолчанию скрыты. */
  include_service?: boolean;
  limit?: number;
  offset?: number;
}

export interface Summary {
  income: number;
  expense: number;
  profit: number;
  net_worth: number;
  total_debt: number;
  refunded: number;
  tx_count: number;
}

export interface CategoryStat {
  category_id: number | null;
  name: string;
  icon: string | null;
  color: string | null;
  total: number;
  count: number;
}

export interface PeriodStat {
  period: string;
  income: number;
  expense: number;
}

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  bank: "Банковский счёт",
  credit: "Кредитная карта",
  crypto: "Криптокошелёк",
  cash: "Наличные",
  deposit: "Вклад или инвестиции",
};

export const DEPOSIT_TYPE_LABELS: Record<DepositType, string> = {
  deposit: "Вклад",
  invest: "Инвестиции",
  betting: "Счёт на ставках",
  other: "Другое",
};

export const CREDIT_KIND_LABELS: Record<CreditKind, string> = {
  loan: "Кредит",
  debt: "Я должен",
  lent: "Мне должны",
};

export const TX_KIND_LABELS: Record<TxKind, string> = {
  income: "Приход",
  expense: "Расход",
  transfer: "Перевод",
};
