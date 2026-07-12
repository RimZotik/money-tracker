use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Account {
    #[serde(default)]
    pub id: i64,
    pub name: String,
    /// 'bank' | 'credit' | 'crypto' | 'cash'
    pub kind: String,
    pub org: Option<String>,
    pub number: Option<String>,
    pub card_last4: Option<String>,
    #[serde(default = "default_currency")]
    pub currency: String,
    #[serde(default)]
    pub opening_balance: f64,
    pub opened_at: Option<String>,
    pub credit_limit: Option<f64>,
    pub rate: Option<f64>,
    pub grace_days: Option<i64>,
    /// Только для kind='deposit': 'deposit' | 'invest' | 'betting' | 'other'
    pub deposit_type: Option<String>,
    pub color: Option<String>,
    #[serde(default)]
    pub archived: bool,
}

fn default_currency() -> String {
    "RUB".to_string()
}

/// Счёт вместе с вычисленным остатком.
#[derive(Debug, Serialize, Clone)]
pub struct AccountWithBalance {
    #[serde(flatten)]
    pub account: Account,
    pub balance: f64,
    /// Для кредитки: сколько лимита ещё доступно.
    pub available: Option<f64>,
    /// Для кредитки: текущий долг (положительное число).
    pub debt: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Category {
    #[serde(default)]
    pub id: i64,
    pub name: String,
    /// 'income' | 'expense'
    pub kind: String,
    pub parent_id: Option<i64>,
    pub icon: Option<String>,
    pub color: Option<String>,
    /// Короткое описание: что сюда относится
    pub note: Option<String>,
    /// Служебная категория (корректировка остатка): скрыта из журнала и аналитики.
    #[serde(default)]
    pub is_service: bool,
    #[serde(default)]
    pub sort: i64,
}

/// Категория со статистикой использования — для страницы настроек.
#[derive(Debug, Serialize, Clone)]
pub struct CategoryWithUsage {
    #[serde(flatten)]
    pub category: Category,
    pub tx_count: i64,
    pub total: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    #[serde(default)]
    pub id: i64,
    pub name: String,
    pub kind: Option<String>,
    pub description: Option<String>,
    #[serde(default = "default_status")]
    pub status: String,
    pub started_at: Option<String>,
    pub closed_at: Option<String>,
    pub color: Option<String>,
}

fn default_status() -> String {
    "active".to_string()
}

/// Проект со сводкой: сколько принёс и сколько съел.
#[derive(Debug, Serialize, Clone)]
pub struct ProjectWithStats {
    #[serde(flatten)]
    pub project: Project,
    pub income: f64,
    pub expense: f64,
    pub profit: f64,
    pub tx_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Credit {
    #[serde(default)]
    pub id: i64,
    pub name: String,
    /// 'loan' | 'debt' | 'lent'
    #[serde(default = "default_credit_kind")]
    pub kind: String,
    pub org: Option<String>,
    pub principal: f64,
    #[serde(default)]
    pub rate: f64,
    #[serde(default)]
    pub grace_days: i64,
    pub term_months: Option<i64>,
    pub opened_at: String,
    pub closed_at: Option<String>,
    pub note: Option<String>,
}

fn default_credit_kind() -> String {
    "loan".to_string()
}

/// Кредит с вычисленным остатком долга.
#[derive(Debug, Serialize, Clone)]
pub struct CreditWithBalance {
    #[serde(flatten)]
    pub credit: Credit,
    /// Сколько ещё осталось выплатить по телу долга.
    pub remaining: f64,
    /// Сколько процентов уже уплачено.
    pub interest_paid: f64,
    /// Доля погашения, 0.0..1.0
    pub progress: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Transaction {
    #[serde(default)]
    pub id: i64,
    /// 'income' | 'expense' | 'transfer'
    pub kind: String,
    pub occurred_at: String,
    pub amount: f64,
    pub account_id: Option<i64>,
    pub to_account_id: Option<i64>,
    pub category_id: Option<i64>,
    pub project_id: Option<i64>,
    pub credit_id: Option<i64>,
    pub principal_part: Option<f64>,
    pub interest_part: Option<f64>,
    pub counterparty: Option<String>,
    pub note: Option<String>,
    /// Операция — возврат покупки; refund_of указывает на исходный расход.
    #[serde(default)]
    pub is_refund: bool,
    pub refund_of: Option<i64>,
    pub ext_id: Option<String>,
    #[serde(default = "default_source")]
    pub source: String,
}

fn default_source() -> String {
    "manual".to_string()
}

/// Операция с уже подставленными названиями связанных сущностей —
/// чтобы фронтенд не собирал их join'ами вручную.
#[derive(Debug, Serialize, Clone)]
pub struct TransactionRow {
    #[serde(flatten)]
    pub tx: Transaction,
    pub account_name: Option<String>,
    pub to_account_name: Option<String>,
    pub category_name: Option<String>,
    pub category_icon: Option<String>,
    pub category_color: Option<String>,
    pub project_name: Option<String>,
    pub credit_name: Option<String>,
}

/// Фильтр для журнала операций. Любое поле — опционально.
#[derive(Debug, Deserialize, Default, Clone)]
pub struct TxFilter {
    pub from: Option<String>,
    pub to: Option<String>,
    pub kind: Option<String>,
    /// Пустой список или None — значит «все счета».
    pub account_ids: Option<Vec<i64>>,
    pub category_id: Option<i64>,
    pub project_id: Option<i64>,
    pub credit_id: Option<i64>,
    pub search: Option<String>,
    /// «Чистый» режим: возврат гасит исходный расход, а не считается доходом.
    /// Купил подписку за 449 и вернул — потрачено 0, а не «расход 449, доход 449».
    #[serde(default)]
    pub net_refunds: bool,
    /// Показывать служебные операции (корректировки остатка). По умолчанию скрыты.
    #[serde(default)]
    pub include_service: bool,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Сводка за период для дашборда.
#[derive(Debug, Serialize, Default)]
pub struct Summary {
    pub income: f64,
    pub expense: f64,
    pub profit: f64,
    pub net_worth: f64,
    pub total_debt: f64,
    /// Сколько денег вернулось возвратами за период — показываем отдельной строкой.
    pub refunded: f64,
    pub tx_count: i64,
}

#[derive(Debug, Serialize)]
pub struct CategoryStat {
    pub category_id: Option<i64>,
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub total: f64,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct PeriodStat {
    /// 'YYYY-MM' или 'YYYY-MM-DD' в зависимости от гранулярности
    pub period: String,
    pub income: f64,
    pub expense: f64,
}
