use crate::db::Db;
use crate::models::*;
use rusqlite::{params, params_from_iter, types::Value, Connection};
use tauri::State;

/// rusqlite-ошибки не умеют пересекать границу в JS — переводим в строку.
fn e<T: std::fmt::Display>(err: T) -> String {
    err.to_string()
}

/// Сумма возвратов, привязанных к расходу. Подставляется подзапросом, чтобы
/// в «чистом» режиме возврат гасил исходный расход, а не висел отдельным доходом.
const REFUNDED: &str = "COALESCE((SELECT SUM(r.amount) FROM transactions r
                                  WHERE r.refund_of = t.id AND r.is_refund = 1), 0)";

// ─── Счета ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_accounts(
    db: State<Db>,
    include_archived: bool,
) -> Result<Vec<AccountWithBalance>, String> {
    let conn = db.0.lock().unwrap();
    let sql = format!(
        "SELECT a.id, a.name, a.kind, a.org, a.number, a.card_last4, a.currency,
                a.opening_balance, a.opened_at, a.credit_limit, a.rate, a.grace_days,
                a.deposit_type, a.color, a.archived, b.balance
         FROM accounts a
         JOIN account_balances b ON b.id = a.id
         {}
         ORDER BY a.archived, a.kind, a.name",
        if include_archived { "" } else { "WHERE a.archived = 0" }
    );

    let mut stmt = conn.prepare(&sql).map_err(e)?;
    let rows = stmt
        .query_map([], |r| {
            let kind: String = r.get(2)?;
            let limit: Option<f64> = r.get(9)?;
            let balance: f64 = r.get(15)?;

            // У кредитки баланс уходит в минус по мере трат: долг — это модуль
            // отрицательного остатка, а доступно = лимит минус долг.
            let (debt, available) = if kind == "credit" {
                let debt = if balance < 0.0 { -balance } else { 0.0 };
                (Some(debt), limit.map(|l| l - debt))
            } else {
                (None, None)
            };

            Ok(AccountWithBalance {
                account: Account {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    kind,
                    org: r.get(3)?,
                    number: r.get(4)?,
                    card_last4: r.get(5)?,
                    currency: r.get(6)?,
                    opening_balance: r.get(7)?,
                    opened_at: r.get(8)?,
                    credit_limit: limit,
                    rate: r.get(10)?,
                    grace_days: r.get(11)?,
                    deposit_type: r.get(12)?,
                    color: r.get(13)?,
                    archived: r.get(14)?,
                },
                balance,
                available,
                debt,
            })
        })
        .map_err(e)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(e)?;

    Ok(rows)
}

#[tauri::command]
pub fn save_account(db: State<Db>, account: Account) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    if account.id == 0 {
        conn.execute(
            "INSERT INTO accounts (name, kind, org, number, card_last4, currency,
                                   opening_balance, opened_at, credit_limit, rate,
                                   grace_days, deposit_type, color, archived)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![
                account.name, account.kind, account.org, account.number, account.card_last4,
                account.currency, account.opening_balance, account.opened_at,
                account.credit_limit, account.rate, account.grace_days, account.deposit_type,
                account.color, account.archived
            ],
        )
        .map_err(e)?;
        Ok(conn.last_insert_rowid())
    } else {
        conn.execute(
            "UPDATE accounts SET name=?1, kind=?2, org=?3, number=?4, card_last4=?5,
                    currency=?6, opening_balance=?7, opened_at=?8, credit_limit=?9,
                    rate=?10, grace_days=?11, deposit_type=?12, color=?13, archived=?14
             WHERE id=?15",
            params![
                account.name, account.kind, account.org, account.number, account.card_last4,
                account.currency, account.opening_balance, account.opened_at,
                account.credit_limit, account.rate, account.grace_days, account.deposit_type,
                account.color, account.archived, account.id
            ],
        )
        .map_err(e)?;
        Ok(account.id)
    }
}

#[tauri::command]
pub fn delete_account(db: State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let used: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM transactions WHERE account_id=?1 OR to_account_id=?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(e)?;
    if used > 0 {
        return Err(format!(
            "По счёту есть {used} операций. Удалить нельзя — заархивируйте счёт."
        ));
    }
    conn.execute("DELETE FROM accounts WHERE id=?1", params![id])
        .map_err(e)?;
    Ok(())
}

// ─── Категории ──────────────────────────────────────────────────────────────

fn map_category(r: &rusqlite::Row, offset: usize) -> rusqlite::Result<Category> {
    Ok(Category {
        id: r.get(offset)?,
        name: r.get(offset + 1)?,
        kind: r.get(offset + 2)?,
        parent_id: r.get(offset + 3)?,
        icon: r.get(offset + 4)?,
        color: r.get(offset + 5)?,
        note: r.get(offset + 6)?,
        is_service: r.get(offset + 7)?,
        sort: r.get(offset + 8)?,
    })
}

/// Служебные категории тут не нужны: их не выбирают руками при создании операции.
#[tauri::command]
pub fn list_categories(db: State<Db>) -> Result<Vec<Category>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, name, kind, parent_id, icon, color, note, is_service, sort
             FROM categories WHERE is_service = 0 ORDER BY kind DESC, sort, name",
        )
        .map_err(e)?;
    let rows = stmt
        .query_map([], |r| map_category(r, 0))
        .map_err(e)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(e)?;
    Ok(rows)
}

/// Категории со статистикой — для страницы настроек: сразу видно, что удаление
/// категории затронет N операций.
#[tauri::command]
pub fn list_categories_usage(db: State<Db>) -> Result<Vec<CategoryWithUsage>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.name, c.kind, c.parent_id, c.icon, c.color, c.note,
                    c.is_service, c.sort,
                    COUNT(t.id), COALESCE(SUM(t.amount), 0)
             FROM categories c
             LEFT JOIN transactions t ON t.category_id = c.id
             GROUP BY c.id
             ORDER BY c.is_service, c.kind DESC, c.sort, c.name",
        )
        .map_err(e)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(CategoryWithUsage {
                category: map_category(r, 0)?,
                tx_count: r.get(9)?,
                total: r.get(10)?,
            })
        })
        .map_err(e)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(e)?;
    Ok(rows)
}

/// Переименование категории автоматически видно во всей истории: в операциях
/// хранится category_id, а не текст.
#[tauri::command]
pub fn save_category(db: State<Db>, category: Category) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    if category.name.trim().is_empty() {
        return Err("Название категории не может быть пустым".into());
    }
    if category.id == 0 {
        conn.execute(
            "INSERT INTO categories (name, kind, parent_id, icon, color, note, sort)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![
                category.name.trim(), category.kind, category.parent_id,
                category.icon, category.color, category.note, category.sort
            ],
        )
        .map_err(e)?;
        Ok(conn.last_insert_rowid())
    } else {
        // is_service намеренно не обновляем: служебность категории задаётся
        // системой, а не пользователем.
        conn.execute(
            "UPDATE categories SET name=?1, kind=?2, parent_id=?3, icon=?4, color=?5,
                    note=?6, sort=?7 WHERE id=?8",
            params![
                category.name.trim(), category.kind, category.parent_id,
                category.icon, category.color, category.note, category.sort, category.id
            ],
        )
        .map_err(e)?;
        Ok(category.id)
    }
}

/// Удаление категории. Операции не пропадают — у них просто становится пустая
/// категория, либо их можно заранее перенести в другую (move_to).
#[tauri::command]
pub fn delete_category(db: State<Db>, id: i64, move_to: Option<i64>) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let service: bool = conn
        .query_row("SELECT is_service FROM categories WHERE id=?1", params![id], |r| r.get(0))
        .map_err(e)?;
    if service {
        return Err("Служебную категорию удалить нельзя".into());
    }
    if let Some(target) = move_to {
        if target == id {
            return Err("Нельзя перенести операции в удаляемую категорию".into());
        }
        conn.execute(
            "UPDATE transactions SET category_id=?1 WHERE category_id=?2",
            params![target, id],
        )
        .map_err(e)?;
    }
    conn.execute("DELETE FROM categories WHERE id=?1", params![id])
        .map_err(e)?;
    Ok(())
}

/// Корректировка остатка счёта: подгоняет баланс под фактический, создавая
/// служебную операцию на разницу. Так остаток сходится с банком, а журнал
/// операций не засоряется — служебные операции в нём скрыты.
#[tauri::command]
pub fn adjust_balance(
    db: State<Db>,
    account_id: i64,
    actual: f64,
    note: Option<String>,
) -> Result<f64, String> {
    let conn = db.0.lock().unwrap();

    let current: f64 = conn
        .query_row(
            "SELECT balance FROM account_balances WHERE id=?1",
            params![account_id],
            |r| r.get(0),
        )
        .map_err(e)?;

    let diff = ((actual - current) * 100.0).round() / 100.0;
    if diff.abs() < 0.01 {
        return Ok(0.0);
    }

    let kind = if diff > 0.0 { "income" } else { "expense" };
    let cat: i64 = conn
        .query_row(
            "SELECT id FROM categories WHERE is_service = 1 AND kind = ?1",
            params![kind],
            |r| r.get(0),
        )
        .map_err(|_| "Служебная категория не найдена".to_string())?;

    conn.execute(
        "INSERT INTO transactions (kind, occurred_at, amount, account_id, category_id,
                                   note, source)
         VALUES (?1, datetime('now', 'localtime'), ?2, ?3, ?4, ?5, 'adjust')",
        params![
            kind,
            diff.abs(),
            account_id,
            cat,
            note.unwrap_or_else(|| "Корректировка остатка вручную".into())
        ],
    )
    .map_err(e)?;

    Ok(diff)
}

// ─── Проекты ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_projects(db: State<Db>) -> Result<Vec<ProjectWithStats>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.name, p.kind, p.description, p.status, p.started_at,
                    p.closed_at, p.color,
                    COALESCE(SUM(CASE WHEN t.kind='income'  THEN t.amount END), 0),
                    COALESCE(SUM(CASE WHEN t.kind='expense' THEN t.amount END), 0),
                    COUNT(t.id)
             FROM projects p
             LEFT JOIN transactions t ON t.project_id = p.id
             GROUP BY p.id
             ORDER BY p.status, p.name",
        )
        .map_err(e)?;
    let rows = stmt
        .query_map([], |r| {
            let income: f64 = r.get(8)?;
            let expense: f64 = r.get(9)?;
            Ok(ProjectWithStats {
                project: Project {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    kind: r.get(2)?,
                    description: r.get(3)?,
                    status: r.get(4)?,
                    started_at: r.get(5)?,
                    closed_at: r.get(6)?,
                    color: r.get(7)?,
                },
                income,
                expense,
                profit: income - expense,
                tx_count: r.get(10)?,
            })
        })
        .map_err(e)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(e)?;
    Ok(rows)
}

#[tauri::command]
pub fn save_project(db: State<Db>, project: Project) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    if project.id == 0 {
        conn.execute(
            "INSERT INTO projects (name, kind, description, status, started_at, closed_at, color)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![
                project.name, project.kind, project.description, project.status,
                project.started_at, project.closed_at, project.color
            ],
        )
        .map_err(e)?;
        Ok(conn.last_insert_rowid())
    } else {
        conn.execute(
            "UPDATE projects SET name=?1, kind=?2, description=?3, status=?4,
                    started_at=?5, closed_at=?6, color=?7 WHERE id=?8",
            params![
                project.name, project.kind, project.description, project.status,
                project.started_at, project.closed_at, project.color, project.id
            ],
        )
        .map_err(e)?;
        Ok(project.id)
    }
}

#[tauri::command]
pub fn delete_project(db: State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM projects WHERE id=?1", params![id])
        .map_err(e)?;
    Ok(())
}

// ─── Кредиты ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_credits(db: State<Db>) -> Result<Vec<CreditWithBalance>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.name, c.kind, c.org, c.principal, c.rate, c.grace_days,
                    c.term_months, c.opened_at, c.closed_at, c.note,
                    b.remaining, b.interest_paid
             FROM credits c
             JOIN credit_balances b ON b.id = c.id
             ORDER BY (c.closed_at IS NOT NULL), c.opened_at DESC",
        )
        .map_err(e)?;
    let rows = stmt
        .query_map([], |r| {
            let principal: f64 = r.get(4)?;
            let remaining: f64 = r.get(11)?;
            Ok(CreditWithBalance {
                credit: Credit {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    kind: r.get(2)?,
                    org: r.get(3)?,
                    principal,
                    rate: r.get(5)?,
                    grace_days: r.get(6)?,
                    term_months: r.get(7)?,
                    opened_at: r.get(8)?,
                    closed_at: r.get(9)?,
                    note: r.get(10)?,
                },
                remaining,
                interest_paid: r.get(12)?,
                progress: if principal > 0.0 {
                    ((principal - remaining) / principal).clamp(0.0, 1.0)
                } else {
                    0.0
                },
            })
        })
        .map_err(e)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(e)?;
    Ok(rows)
}

#[tauri::command]
pub fn save_credit(db: State<Db>, credit: Credit) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    if credit.id == 0 {
        conn.execute(
            "INSERT INTO credits (name, kind, org, principal, rate, grace_days,
                                  term_months, opened_at, closed_at, note)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                credit.name, credit.kind, credit.org, credit.principal, credit.rate,
                credit.grace_days, credit.term_months, credit.opened_at,
                credit.closed_at, credit.note
            ],
        )
        .map_err(e)?;
        Ok(conn.last_insert_rowid())
    } else {
        conn.execute(
            "UPDATE credits SET name=?1, kind=?2, org=?3, principal=?4, rate=?5,
                    grace_days=?6, term_months=?7, opened_at=?8, closed_at=?9, note=?10
             WHERE id=?11",
            params![
                credit.name, credit.kind, credit.org, credit.principal, credit.rate,
                credit.grace_days, credit.term_months, credit.opened_at,
                credit.closed_at, credit.note, credit.id
            ],
        )
        .map_err(e)?;
        Ok(credit.id)
    }
}

#[tauri::command]
pub fn delete_credit(db: State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM credits WHERE id=?1", params![id])
        .map_err(e)?;
    Ok(())
}

// ─── Операции ───────────────────────────────────────────────────────────────

const TX_SELECT: &str = "
    SELECT t.id, t.kind, t.occurred_at, t.amount, t.account_id, t.to_account_id,
           t.category_id, t.project_id, t.credit_id, t.principal_part, t.interest_part,
           t.counterparty, t.note, t.is_refund, t.refund_of, t.ext_id, t.source,
           a.name, a2.name, c.name, c.icon, c.color, p.name, cr.name
    FROM transactions t
    LEFT JOIN accounts   a  ON a.id  = t.account_id
    LEFT JOIN accounts   a2 ON a2.id = t.to_account_id
    LEFT JOIN categories c  ON c.id  = t.category_id
    LEFT JOIN projects   p  ON p.id  = t.project_id
    LEFT JOIN credits    cr ON cr.id = t.credit_id";

fn map_tx(r: &rusqlite::Row) -> rusqlite::Result<TransactionRow> {
    Ok(TransactionRow {
        tx: Transaction {
            id: r.get(0)?,
            kind: r.get(1)?,
            occurred_at: r.get(2)?,
            amount: r.get(3)?,
            account_id: r.get(4)?,
            to_account_id: r.get(5)?,
            category_id: r.get(6)?,
            project_id: r.get(7)?,
            credit_id: r.get(8)?,
            principal_part: r.get(9)?,
            interest_part: r.get(10)?,
            counterparty: r.get(11)?,
            note: r.get(12)?,
            is_refund: r.get(13)?,
            refund_of: r.get(14)?,
            ext_id: r.get(15)?,
            source: r.get(16)?,
        },
        account_name: r.get(17)?,
        to_account_name: r.get(18)?,
        category_name: r.get(19)?,
        category_icon: r.get(20)?,
        category_color: r.get(21)?,
        project_name: r.get(22)?,
        credit_name: r.get(23)?,
    })
}

/// Собирает WHERE из непустых полей фильтра.
fn build_where(f: &TxFilter) -> (String, Vec<Value>) {
    let mut clauses: Vec<String> = Vec::new();
    let mut args: Vec<Value> = Vec::new();

    if let Some(v) = &f.from {
        clauses.push(format!("t.occurred_at >= ?{}", args.len() + 1));
        args.push(Value::Text(v.clone()));
    }
    if let Some(v) = &f.to {
        // Включаем весь конечный день, а не только его полночь.
        clauses.push(format!("t.occurred_at <= ?{}", args.len() + 1));
        args.push(Value::Text(format!("{v} 23:59:59")));
    }
    if let Some(v) = &f.kind {
        clauses.push(format!("t.kind = ?{}", args.len() + 1));
        args.push(Value::Text(v.clone()));
    }
    if let Some(ids) = &f.account_ids {
        if !ids.is_empty() {
            let ph: Vec<String> = ids
                .iter()
                .enumerate()
                .map(|(i, _)| format!("?{}", args.len() + 1 + i))
                .collect();
            clauses.push(format!(
                "(t.account_id IN ({p}) OR t.to_account_id IN ({p}))",
                p = ph.join(",")
            ));
            for id in ids {
                args.push(Value::Integer(*id));
            }
        }
    }
    if let Some(v) = f.category_id {
        // Родительская категория тянет за собой свои подкатегории.
        clauses.push(format!(
            "(t.category_id = ?{n}
              OR t.category_id IN (SELECT id FROM categories WHERE parent_id = ?{n}))",
            n = args.len() + 1
        ));
        args.push(Value::Integer(v));
    }
    if let Some(v) = f.project_id {
        clauses.push(format!("t.project_id = ?{}", args.len() + 1));
        args.push(Value::Integer(v));
    }
    if let Some(v) = f.credit_id {
        clauses.push(format!("t.credit_id = ?{}", args.len() + 1));
        args.push(Value::Integer(v));
    }
    if let Some(v) = &f.search {
        if !v.trim().is_empty() {
            clauses.push(format!(
                "(t.counterparty LIKE ?{n} OR t.note LIKE ?{n})",
                n = args.len() + 1
            ));
            args.push(Value::Text(format!("%{}%", v.trim())));
        }
    }

    // Корректировки остатка нужны, чтобы баланс сходился с банком, но в журнале
    // и аналитике они только шумят — по умолчанию скрываем.
    // `NULL NOT IN (…)` даёт NULL, поэтому операции без категории надо пропускать
    // явно — иначе они бы отфильтровались вместе со служебными.
    if !f.include_service {
        clauses.push(
            "(t.category_id IS NULL
              OR t.category_id NOT IN (SELECT id FROM categories WHERE is_service = 1))"
                .to_string(),
        );
    }

    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    (where_sql, args)
}

#[tauri::command]
pub fn list_transactions(db: State<Db>, filter: TxFilter) -> Result<Vec<TransactionRow>, String> {
    let conn = db.0.lock().unwrap();
    let (where_sql, mut args) = build_where(&filter);

    let limit = filter.limit.unwrap_or(200);
    let offset = filter.offset.unwrap_or(0);
    let sql = format!(
        "{TX_SELECT} {where_sql} ORDER BY t.occurred_at DESC, t.id DESC LIMIT ?{} OFFSET ?{}",
        args.len() + 1,
        args.len() + 2
    );
    args.push(Value::Integer(limit));
    args.push(Value::Integer(offset));

    let mut stmt = conn.prepare(&sql).map_err(e)?;
    let rows = stmt
        .query_map(params_from_iter(args), map_tx)
        .map_err(e)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(e)?;
    Ok(rows)
}

#[tauri::command]
pub fn count_transactions(db: State<Db>, filter: TxFilter) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    let (where_sql, args) = build_where(&filter);
    let sql = format!("SELECT COUNT(*) FROM transactions t {where_sql}");
    conn.query_row(&sql, params_from_iter(args), |r| r.get(0))
        .map_err(e)
}

#[tauri::command]
pub fn save_transaction(db: State<Db>, tx: Transaction) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    validate_tx(&tx)?;

    if tx.id == 0 {
        conn.execute(
            "INSERT INTO transactions (kind, occurred_at, amount, account_id, to_account_id,
                                       category_id, project_id, credit_id, principal_part,
                                       interest_part, counterparty, note, is_refund, refund_of,
                                       ext_id, source)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
            params![
                tx.kind, tx.occurred_at, tx.amount, tx.account_id, tx.to_account_id,
                tx.category_id, tx.project_id, tx.credit_id, tx.principal_part,
                tx.interest_part, tx.counterparty, tx.note, tx.is_refund, tx.refund_of,
                tx.ext_id, tx.source
            ],
        )
        .map_err(e)?;
        Ok(conn.last_insert_rowid())
    } else {
        conn.execute(
            "UPDATE transactions SET kind=?1, occurred_at=?2, amount=?3, account_id=?4,
                    to_account_id=?5, category_id=?6, project_id=?7, credit_id=?8,
                    principal_part=?9, interest_part=?10, counterparty=?11, note=?12,
                    is_refund=?13, refund_of=?14
             WHERE id=?15",
            params![
                tx.kind, tx.occurred_at, tx.amount, tx.account_id, tx.to_account_id,
                tx.category_id, tx.project_id, tx.credit_id, tx.principal_part,
                tx.interest_part, tx.counterparty, tx.note, tx.is_refund, tx.refund_of,
                tx.id
            ],
        )
        .map_err(e)?;
        Ok(tx.id)
    }
}

fn validate_tx(tx: &Transaction) -> Result<(), String> {
    if tx.amount <= 0.0 {
        return Err("Сумма должна быть больше нуля".into());
    }
    if tx.kind == "transfer" {
        if tx.account_id.is_none() || tx.to_account_id.is_none() {
            return Err("У перевода нужно указать оба счёта".into());
        }
        if tx.account_id == tx.to_account_id {
            return Err("Перевод на тот же самый счёт невозможен".into());
        }
    } else if tx.account_id.is_none() {
        return Err("Не указан счёт".into());
    }

    // Платёж по кредиту: тело + проценты не должны превышать сумму платежа.
    if let (Some(p), Some(i)) = (tx.principal_part, tx.interest_part) {
        if p + i > tx.amount + 0.01 {
            return Err("Тело долга и проценты в сумме больше платежа".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn delete_transaction(db: State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM transactions WHERE id=?1", params![id])
        .map_err(e)?;
    Ok(())
}

// ─── Аналитика ──────────────────────────────────────────────────────────────

/// Сводка за период. Переводы исключены: перекладывание денег из кармана в
/// карман — не доход и не расход.
///
/// В режиме net_refunds возврат гасит исходный расход (купил подписку за 449 и
/// вернул — потрачено 0). Иначе возврат считается обычным доходом.
#[tauri::command]
pub fn summary(db: State<Db>, filter: TxFilter) -> Result<Summary, String> {
    let conn = db.0.lock().unwrap();
    let (where_sql, args) = build_where(&filter);
    let and = if where_sql.is_empty() { "WHERE" } else { "AND" };

    // Из расхода всегда вычитаем тело долга: погашение кредита — не трата,
    // тратой являются только проценты.
    let expense_expr = if filter.net_refunds {
        format!("t.amount - COALESCE(t.principal_part, 0) - {REFUNDED}")
    } else {
        "t.amount - COALESCE(t.principal_part, 0)".to_string()
    };
    let income_filter = if filter.net_refunds {
        "AND t.is_refund = 0"
    } else {
        ""
    };

    let sql = format!(
        "SELECT
            COALESCE(SUM(CASE WHEN t.kind='income' {income_filter} THEN t.amount END), 0),
            COALESCE(SUM(CASE WHEN t.kind='expense' THEN {expense_expr} END), 0),
            COALESCE(SUM(CASE WHEN t.is_refund=1 THEN t.amount END), 0),
            COUNT(*)
         FROM transactions t {where_sql} {and} t.kind <> 'transfer'"
    );

    let (income, expense, refunded, tx_count): (f64, f64, f64, i64) = conn
        .query_row(&sql, params_from_iter(args), |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .map_err(e)?;

    // Капитал и долги — всегда на «сейчас», а не за период.
    let net_worth: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(balance), 0) FROM account_balances",
            [],
            |r| r.get(0),
        )
        .map_err(e)?;

    let card_debt: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(CASE WHEN balance < 0 THEN -balance END), 0)
             FROM account_balances WHERE kind = 'credit'",
            [],
            |r| r.get(0),
        )
        .map_err(e)?;

    let loan_debt: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(CASE WHEN remaining > 0 THEN remaining END), 0)
             FROM credit_balances WHERE kind IN ('loan', 'debt')",
            [],
            |r| r.get(0),
        )
        .map_err(e)?;

    Ok(Summary {
        income,
        expense,
        profit: income - expense,
        net_worth,
        total_debt: card_debt + loan_debt,
        refunded,
        tx_count,
    })
}

/// Разбивка по категориям за период. kind = 'income' | 'expense'.
#[tauri::command]
pub fn category_stats(
    db: State<Db>,
    kind: String,
    filter: TxFilter,
) -> Result<Vec<CategoryStat>, String> {
    let conn = db.0.lock().unwrap();
    let mut f = filter.clone();
    f.kind = Some(kind.clone());
    let (where_sql, args) = build_where(&f);

    let amount_expr = if filter.net_refunds && kind == "expense" {
        format!("t.amount - COALESCE(t.principal_part, 0) - {REFUNDED}")
    } else {
        "t.amount - COALESCE(t.principal_part, 0)".to_string()
    };
    // В чистом режиме возврат не доход — он уже вычтен из расхода.
    let extra = if filter.net_refunds && kind == "income" {
        "AND t.is_refund = 0"
    } else {
        ""
    };
    let and = if where_sql.is_empty() { "WHERE" } else { "AND" };

    // Подкатегории сворачиваем в родителя — иначе диаграмма превращается в кашу.
    let sql = format!(
        "SELECT COALESCE(top.id, c.id) AS cid,
                COALESCE(top.name, c.name, 'Без категории') AS cname,
                COALESCE(top.icon, c.icon),
                COALESCE(top.color, c.color),
                SUM({amount_expr}),
                COUNT(t.id)
         FROM transactions t
         LEFT JOIN categories c   ON c.id = t.category_id
         LEFT JOIN categories top ON top.id = c.parent_id
         {where_sql} {and} 1=1 {extra}
         GROUP BY cid
         HAVING SUM({amount_expr}) > 0
         ORDER BY 5 DESC"
    );

    let mut stmt = conn.prepare(&sql).map_err(e)?;
    let rows = stmt
        .query_map(params_from_iter(args), |r| {
            Ok(CategoryStat {
                category_id: r.get(0)?,
                name: r.get(1)?,
                icon: r.get(2)?,
                color: r.get(3)?,
                total: r.get(4)?,
                count: r.get(5)?,
            })
        })
        .map_err(e)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(e)?;
    Ok(rows)
}

/// Динамика доход/расход по периодам. granularity = 'day' | 'month' | 'year'.
#[tauri::command]
pub fn period_stats(
    db: State<Db>,
    granularity: String,
    filter: TxFilter,
) -> Result<Vec<PeriodStat>, String> {
    let conn = db.0.lock().unwrap();
    let fmt = match granularity.as_str() {
        "day" => "%Y-%m-%d",
        "year" => "%Y",
        _ => "%Y-%m",
    };
    let (where_sql, args) = build_where(&filter);
    let and = if where_sql.is_empty() { "WHERE" } else { "AND" };

    let expense_expr = if filter.net_refunds {
        format!("t.amount - COALESCE(t.principal_part, 0) - {REFUNDED}")
    } else {
        "t.amount - COALESCE(t.principal_part, 0)".to_string()
    };
    let income_filter = if filter.net_refunds {
        "AND t.is_refund = 0"
    } else {
        ""
    };

    let sql = format!(
        "SELECT strftime('{fmt}', t.occurred_at) AS p,
                COALESCE(SUM(CASE WHEN t.kind='income' {income_filter} THEN t.amount END), 0),
                COALESCE(SUM(CASE WHEN t.kind='expense' THEN {expense_expr} END), 0)
         FROM transactions t {where_sql} {and} t.kind <> 'transfer'
         GROUP BY p ORDER BY p"
    );

    let mut stmt = conn.prepare(&sql).map_err(e)?;
    let rows = stmt
        .query_map(params_from_iter(args), |r| {
            Ok(PeriodStat {
                period: r.get(0)?,
                income: r.get(1)?,
                expense: r.get(2)?,
            })
        })
        .map_err(e)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(e)?;
    Ok(rows)
}

/// Баланс счёта на конкретную дату — «как в 1С», считается из журнала.
#[tauri::command]
pub fn balance_at(db: State<Db>, account_id: i64, at: String) -> Result<f64, String> {
    let conn = db.0.lock().unwrap();
    balance_at_inner(&conn, account_id, &at).map_err(e)
}

fn balance_at_inner(conn: &Connection, account_id: i64, at: &str) -> rusqlite::Result<f64> {
    conn.query_row(
        "SELECT a.opening_balance
                + COALESCE((SELECT SUM(CASE t.kind WHEN 'income' THEN t.amount ELSE -t.amount END)
                            FROM transactions t
                            WHERE t.account_id = a.id AND t.occurred_at <= ?2), 0)
                + COALESCE((SELECT SUM(t.amount) FROM transactions t
                            WHERE t.to_account_id = a.id AND t.occurred_at <= ?2), 0)
         FROM accounts a WHERE a.id = ?1",
        params![account_id, format!("{at} 23:59:59")],
        |r| r.get(0),
    )
}

/// Динамика общего капитала по дням — «сколько всего денег у меня было».
///
/// Считается назад от текущего остатка: сегодняшний капитал известен точно
/// (он сходится с банком), поэтому идём от него в прошлое, вычитая движения.
/// Так линия обязательно заканчивается на реальной сумме, а не на накопленной
/// ошибке начальных остатков.
#[tauri::command]
pub fn net_worth_series(
    db: State<Db>,
    from: Option<String>,
    to: Option<String>,
) -> Result<Vec<PeriodStat>, String> {
    let conn = db.0.lock().unwrap();

    let today: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(balance), 0) FROM account_balances",
            [],
            |r| r.get(0),
        )
        .map_err(e)?;

    // Все дневные изменения капитала. Переводы между своими счетами капитал не
    // меняют, поэтому в расчёт не идут.
    let mut stmt = conn
        .prepare(
            "SELECT date(occurred_at) AS d,
                    COALESCE(SUM(CASE WHEN kind='income'  THEN amount
                                      WHEN kind='expense' THEN -amount END), 0)
             FROM transactions
             WHERE kind <> 'transfer'
             GROUP BY d ORDER BY d",
        )
        .map_err(e)?;

    let deltas: Vec<(String, f64)> = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))
        .map_err(e)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(e)?;

    // Идём с конца: капитал на день D = капитал сегодня минус всё, что пришло после D.
    let mut running = today;
    let mut series: Vec<(String, f64)> = Vec::with_capacity(deltas.len());
    for (day, delta) in deltas.iter().rev() {
        series.push((day.clone(), running));
        running -= delta;
    }
    series.reverse();

    Ok(series
        .into_iter()
        .filter(|(day, _)| {
            from.as_ref().map_or(true, |f| day.as_str() >= f.as_str())
                && to.as_ref().map_or(true, |t| day.as_str() <= t.as_str())
        })
        .map(|(day, worth)| PeriodStat {
            period: day,
            income: worth,
            expense: 0.0,
        })
        .collect())
}
