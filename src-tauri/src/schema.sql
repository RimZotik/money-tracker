-- Money Tracker — схема БД.
--
-- Главный принцип: остатки нигде не хранятся. Баланс счёта и долг по кредиту
-- всегда вычисляются из журнала операций (см. VIEW внизу). Поэтому правка
-- операции любой давности автоматически пересчитывает всё до текущего дня.

PRAGMA foreign_keys = ON;

-- ── Счета ───────────────────────────────────────────────────────────────────
-- kind: 'bank'    — банковский счёт/дебетовая карта (org = банк, number = счёт)
--       'credit'  — кредитная карта (org = банк, есть лимит/ставка/грейс)
--       'crypto'  — криптокошелёк (org = сеть/биржа, number = адрес)
--       'cash'    — наличные
--       'deposit' — вклад, брокерский счёт, счёт на ставках. Живёт на отдельной
--                   странице «Вклады», но по сути это тот же счёт: деньги на него
--                   попадают переводом, и его баланс считается так же.
CREATE TABLE IF NOT EXISTS accounts (
    id              INTEGER PRIMARY KEY,
    name            TEXT    NOT NULL,
    kind            TEXT    NOT NULL CHECK (kind IN ('bank', 'credit', 'crypto', 'cash', 'deposit')),
    org             TEXT,
    number          TEXT,
    card_last4      TEXT,
    currency        TEXT    NOT NULL DEFAULT 'RUB',

    -- Остаток на момент opened_at. Всё, что было до появления счёта в учёте.
    opening_balance REAL    NOT NULL DEFAULT 0,
    opened_at       TEXT,

    -- Только для kind='credit'
    credit_limit    REAL,
    rate            REAL,               -- % годовых (у вклада — доходность)
    grace_days      INTEGER,            -- беспроцентный период, дней

    -- Только для kind='deposit': 'deposit' | 'invest' | 'betting' | 'other'
    deposit_type    TEXT,

    color           TEXT,
    archived        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Категории (двухуровневые) ───────────────────────────────────────────────
-- Переименование категории автоматически отражается во всей истории операций:
-- в transactions лежит category_id, а не название.
CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    kind       TEXT    NOT NULL CHECK (kind IN ('income', 'expense')),
    parent_id  INTEGER REFERENCES categories (id) ON DELETE CASCADE,
    icon       TEXT,
    color      TEXT,
    note       TEXT,                    -- короткое описание: что сюда относится
    -- Служебная категория (корректировка остатка). Такие операции нужны, чтобы
    -- остаток сходился с банком, но в журнале и аналитике они только мешают —
    -- поэтому по умолчанию скрыты.
    is_service INTEGER NOT NULL DEFAULT 0,
    sort       INTEGER NOT NULL DEFAULT 0
);

-- ── Проекты (YouTube-каналы, приложения, игры) ──────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL,
    kind        TEXT,                   -- 'youtube' | 'app' | 'game' | ...
    description TEXT,
    status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'done')),
    started_at  TEXT,
    closed_at   TEXT,
    color       TEXT
);

-- ── Кредиты и долги ─────────────────────────────────────────────────────────
-- kind: 'loan'   — кредит/рассрочка (тело гасится платежами)
--       'debt'   — я должен человеку
--       'lent'   — мне должны
-- Кредитная карта здесь НЕ нужна: она заведена как счёт kind='credit',
-- её долг — это просто отрицательный баланс счёта.
CREATE TABLE IF NOT EXISTS credits (
    id           INTEGER PRIMARY KEY,
    name         TEXT    NOT NULL,
    kind         TEXT    NOT NULL DEFAULT 'loan' CHECK (kind IN ('loan', 'debt', 'lent')),
    org          TEXT,                  -- банк или имя человека
    principal    REAL    NOT NULL,      -- сумма кредита (тело на старте)
    rate         REAL    NOT NULL DEFAULT 0,
    grace_days   INTEGER NOT NULL DEFAULT 0,
    term_months  INTEGER,
    opened_at    TEXT    NOT NULL,
    closed_at    TEXT,
    note         TEXT
);

-- ── Операции ────────────────────────────────────────────────────────────────
-- kind: 'income'   — приход  (деньги приходят на account_id)
--       'expense'  — расход  (деньги уходят с account_id)
--       'transfer' — перевод (с account_id на to_account_id; не доход и не расход)
--
-- Платёж по кредиту — это expense с заполненным credit_id, где сумма разложена
-- на principal_part (уменьшает долг, но НЕ является тратой) и interest_part
-- (настоящий расход). Так кредит корректно «уменьшается в отображении».
CREATE TABLE IF NOT EXISTS transactions (
    id             INTEGER PRIMARY KEY,
    kind           TEXT    NOT NULL CHECK (kind IN ('income', 'expense', 'transfer')),
    occurred_at    TEXT    NOT NULL,     -- 'YYYY-MM-DD HH:MM:SS'
    amount         REAL    NOT NULL CHECK (amount > 0),

    account_id     INTEGER REFERENCES accounts (id) ON DELETE RESTRICT,
    to_account_id  INTEGER REFERENCES accounts (id) ON DELETE RESTRICT,

    category_id    INTEGER REFERENCES categories (id) ON DELETE SET NULL,
    project_id     INTEGER REFERENCES projects   (id) ON DELETE SET NULL,
    credit_id      INTEGER REFERENCES credits    (id) ON DELETE SET NULL,

    principal_part REAL,                 -- тело долга в платеже по кредиту
    interest_part  REAL,                 -- проценты в платеже по кредиту

    counterparty   TEXT,                 -- мерчант / от кого / кому
    note           TEXT,

    -- Возврат покупки. Банк отдаёт его тем же кодом авторизации, что и саму
    -- покупку, поэтому связь надёжная. В «чистом» режиме дашборда возврат
    -- гасит исходный расход: купил подписку за 499 и вернул — потрачено 0,
    -- а не «расход 499 и доход 499».
    is_refund      INTEGER NOT NULL DEFAULT 0,
    refund_of      INTEGER REFERENCES transactions (id) ON DELETE SET NULL,

    ext_id         TEXT UNIQUE,          -- ключ из выписки, защита от повторного импорта
    source         TEXT    NOT NULL DEFAULT 'manual',  -- 'manual' | 'import:sber'
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),

    -- У перевода обязателен счёт-получатель, у прихода/расхода его быть не должно
    CHECK (
        (kind = 'transfer' AND to_account_id IS NOT NULL AND account_id IS NOT NULL)
        OR (kind <> 'transfer' AND to_account_id IS NULL)
    ),
    CHECK (account_id IS NOT to_account_id OR kind <> 'transfer')
);

CREATE INDEX IF NOT EXISTS idx_tx_occurred ON transactions (occurred_at);
CREATE INDEX IF NOT EXISTS idx_tx_account  ON transactions (account_id);
CREATE INDEX IF NOT EXISTS idx_tx_to_acct  ON transactions (to_account_id);
CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions (category_id);
CREATE INDEX IF NOT EXISTS idx_tx_credit   ON transactions (credit_id);
CREATE INDEX IF NOT EXISTS idx_tx_project  ON transactions (project_id);

-- ── Правила автокатегоризации ───────────────────────────────────────────────
-- При импорте выписки описание операции матчится на pattern (подстрока,
-- регистронезависимо). Первое совпадение с наибольшим priority выигрывает.
CREATE TABLE IF NOT EXISTS rules (
    id          INTEGER PRIMARY KEY,
    pattern     TEXT    NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
    project_id  INTEGER REFERENCES projects (id) ON DELETE SET NULL,
    priority    INTEGER NOT NULL DEFAULT 0
);

-- ── Балансы счетов (вычисляемые, не хранимые) ───────────────────────────────
CREATE VIEW IF NOT EXISTS account_balances AS
SELECT a.id,
       a.name,
       a.kind,
       a.currency,
       a.credit_limit,
       a.opening_balance
           + COALESCE((SELECT SUM(CASE t.kind
                                      WHEN 'income' THEN t.amount
                                      ELSE -t.amount          -- expense и transfer-исходящий
                                  END)
                       FROM transactions t
                       WHERE t.account_id = a.id), 0)
           + COALESCE((SELECT SUM(t.amount)
                       FROM transactions t
                       WHERE t.to_account_id = a.id), 0)      -- transfer-входящий
           AS balance
FROM accounts a;

-- ── Остаток долга по кредитам ───────────────────────────────────────────────
CREATE VIEW IF NOT EXISTS credit_balances AS
SELECT c.id,
       c.name,
       c.kind,
       c.principal,
       c.rate,
       c.principal - COALESCE((SELECT SUM(COALESCE(t.principal_part, t.amount))
                               FROM transactions t
                               WHERE t.credit_id = c.id), 0) AS remaining,
       COALESCE((SELECT SUM(COALESCE(t.interest_part, 0))
                 FROM transactions t
                 WHERE t.credit_id = c.id), 0)               AS interest_paid
FROM credits c;
