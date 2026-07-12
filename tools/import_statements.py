"""
Импорт банковских выписок в базу Money Tracker.

    python tools/import_statements.py            # разбор и отчёт, база не трогается
    python tools/import_statements.py --write    # записать в базу
    python tools/import_statements.py --write --reset   # снести базу и залить заново

Поддерживаются Сбербанк (PDF), Озон Банк (PDF), Т-Банк (CSV). Запускать из корня
проекта, где лежат файлы выписок.

Ключевая идея: сначала операции ВСЕХ банков собираются в общий список, и только
потом ищутся переводы между своими счетами. Поэтому перевод Сбер → Озон виден с
обеих сторон и склеивается в одну операцию Transfer, а не в расход плюс доход.
"""

import argparse
import os
import sqlite3
import sys
from collections import defaultdict
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from banks import PARSERS                       # noqa: E402
from banks.common import DB_PATH                # noqa: E402

# Разброс по времени, в пределах которого две операции считаются одним переводом.
# Между разными банками зачисление может отстать от списания на часы.
PAIR_WINDOW = timedelta(hours=6)

# Счета, которых нет ни в одной выписке, но про которые известен текущий остаток.
# Их начальный остаток подбирается так, чтобы итог сошёлся с фактом.
KNOWN_BALANCE = {
    'Т-Инвестиции': 0.0,
    'Наличные': 0.0,
}

# Вклады, брокерские счета и прочее, что живёт на странице «Вклады».
DEPOSIT_ACCOUNTS = {
    'Т-Инвестиции': 'invest',
}

CASH_ACCOUNT = 'Наличные'


# ─────────────────────────── сбор операций ───────────────────────────

def collect(root='.'):
    accounts, ops = {}, []
    for mod in PARSERS:
        for path in mod.files(root):
            accs, o = mod.parse(path)
            for a in accs:
                key = a['key']
                if key in accounts:
                    # Один счёт может быть разбит на несколько выписок подряд.
                    old = accounts[key]
                    if a['period_start'] and old['period_start'] and a['period_start'] < old['period_start']:
                        old['opening_balance'] = a['opening_balance']
                        old['period_start'] = a['period_start']
                    if a['close_date'] and (not old['close_date'] or a['close_date'] > old['close_date']):
                        old['close_date'] = a['close_date']
                        old['close_balance'] = a['close_balance']
                else:
                    accounts[key] = a
            ops.extend(o)
            print(f'  {os.path.basename(path):45} {len(o):>5} операций')
    return accounts, ops


# Возврат может прийти сильно позже покупки (банк обрабатывает неделями)
REFUND_WINDOW = timedelta(days=60)


def match_refunds(ops):
    """
    Находит возвраты покупок и привязывает их к исходному расходу.

    Два способа, потому что банк непоследователен:
      1) тот же код авторизации, та же сумма — самый надёжный признак;
      2) банк сам назвал операцию возвратом («Возврат покупки по QR-коду СБП»),
         но выдал новый код авторизации — тогда ищем расход тем же мерчантом
         на ту же сумму в пределах двух месяцев до возврата.

    → {id(входящей операции): исходящая операция}
    """
    expenses = [o for o in ops if not o.income and not o.self_transfer and not o.cash]

    by_auth = defaultdict(list)
    for o in expenses:
        if o.auth:
            by_auth[(o.acct, o.auth, round(o.amount, 2))].append(o)

    refunds, used = {}, set()

    def take(cand, inc):
        used.add(id(cand))
        refunds[id(inc)] = cand

    for o in ops:
        if o.income is False or o.self_transfer or o.cash:
            continue

        # (1) по коду авторизации
        hit = next((c for c in by_auth.get((o.acct, o.auth, round(o.amount, 2)), [])
                    if id(c) not in used), None) if o.auth else None
        if hit:
            take(hit, o)
            continue

        # (2) банк явно назвал операцию возвратом
        if 'озврат' not in o.bank_cat and 'озврат' not in o.desc:
            continue
        best = None
        for c in expenses:
            if id(c) in used or c.acct != o.acct:
                continue
            if round(c.amount, 2) != round(o.amount, 2):
                continue
            if not (timedelta(0) <= o.dt - c.dt <= REFUND_WINDOW):
                continue
            # мерчант должен совпадать — иначе это просто совпадение сумм
            if c.counterparty and o.counterparty and c.counterparty != o.counterparty:
                continue
            if best is None or c.dt > best.dt:
                best = c
        if best:
            take(best, o)

    return refunds


def match_transfers(ops):
    """
    Склеивает переводы самому себе в пары (исходящая, входящая).
    Пара — одинаковая сумма, разные счета, расхождение по времени в пределах окна.
    Работает поверх операций всех банков сразу.
    """
    outs = sorted((o for o in ops if o.self_transfer and not o.income), key=lambda o: o.dt)
    ins = [o for o in ops if o.self_transfer and o.income]

    by_amount = defaultdict(list)
    for o in ins:
        by_amount[round(o.amount, 2)].append(o)

    pairs, used = [], set()
    for out in outs:
        best, best_gap = None, PAIR_WINDOW
        for cand in by_amount.get(round(out.amount, 2), []):
            if id(cand) in used or cand.acct == out.acct:
                continue
            gap = abs(cand.dt - out.dt)
            if gap <= best_gap:
                best, best_gap = cand, gap
        if best:
            used.add(id(best))
            pairs.append((out, best))

    return pairs


# ─────────────────────────── запись ───────────────────────────

def load_rules(conn):
    """Правила вместе с типом категории: доходное правило не должно срабатывать
    на расходе (иначе возврат из Steam уезжает в «Покупку игр»)."""
    return conn.execute(
        '''SELECT r.pattern, r.category_id, c.kind
           FROM rules r JOIN categories c ON c.id = r.category_id
           ORDER BY r.priority DESC'''
    ).fetchall()


def categorize(text, rules, kind, fallback):
    low = text.lower()
    for pattern, cid, rule_kind in rules:
        if rule_kind == kind and pattern.lower() in low:
            return cid
    return fallback


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true', help='записать в базу')
    ap.add_argument('--reset', action='store_true', help='пересоздать базу с нуля')
    ap.add_argument('--db', default=DB_PATH)
    args = ap.parse_args()

    print('Разбор выписок:')
    accounts, ops = collect()
    if not ops:
        sys.exit('Выписки не найдены. Запускайте из корня проекта.')

    pairs = match_transfers(ops)
    paired_in = {id(b) for _, b in pairs}
    pair_of = {id(a): b for a, b in pairs}
    refunds = match_refunds(ops)

    self_ops = [o for o in ops if o.self_transfer]
    cross = sum(1 for a, b in pairs if a.src != b.src)

    print(f'\nВсего операций: {len(ops)} по {len(accounts)} счетам')
    print(f'Переводы самому себе: {len(self_ops)}')
    print(f'  склеено в пары: {len(pairs)} (из них между разными банками: {cross})')
    print(f'  без пары: {len(self_ops) - len(pairs) * 2}')
    print(f'Изменений кредитного лимита (не деньги): {sum(1 for o in ops if o.limit_change)}')
    print(f'Операций с наличными: {sum(1 for o in ops if o.cash)}')
    print(f'Возвратов покупок (гасят исходный расход): {len(refunds)}')

    if not args.write:
        print('\n— пробный прогон, база не тронута. Повторите с --write —')
        return

    if args.reset:
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        for suf in ('', '-wal', '-shm'):
            if os.path.exists(args.db + suf):
                os.remove(args.db + suf)
        os.makedirs(os.path.dirname(args.db), exist_ok=True)
        conn = sqlite3.connect(args.db)
        for f in ('schema.sql', 'seed.sql'):
            with open(os.path.join(here, 'src-tauri', 'src', f), encoding='utf-8') as fh:
                conn.executescript(fh.read())
        conn.commit()
        print('\nБаза пересоздана.')
    elif not os.path.exists(args.db):
        sys.exit(f'База не найдена: {args.db}\nЗапустите приложение хотя бы раз или добавьте --reset.')
    else:
        conn = sqlite3.connect(args.db)

    conn.execute('PRAGMA foreign_keys = ON')
    rules = load_rules(conn)

    def cat_id(name, kind):
        return conn.execute(
            'SELECT id FROM categories WHERE name=? AND kind=?', (name, kind)
        ).fetchone()[0]

    other_exp = cat_id('Прочее', 'expense')
    other_inc = cat_id('Прочее', 'income')
    transfer_exp = cat_id('Переводы', 'expense')
    interest_cat = cat_id('Кредит', 'expense')
    # Корректировки лежат в служебной категории и скрыты из журнала и аналитики
    fix_exp = cat_id('Корректировка остатка', 'expense')
    fix_inc = cat_id('Корректировка остатка', 'income')

    # ── счета ────────────────────────────────────────────────────────────────
    acct_ids = {}
    for key, a in accounts.items():
        row = conn.execute('SELECT id FROM accounts WHERE name=?', (a['name'],)).fetchone()
        if row:
            acct_ids[key] = row[0]
            continue
        cur = conn.execute(
            """INSERT INTO accounts (name, kind, org, number, card_last4, currency,
                                     opening_balance, credit_limit, rate, grace_days)
               VALUES (?,?,?,?,?,'RUB',?,?,?,?)""",
            (a['name'], a['kind'], a['org'], a['number'], a['card_last4'],
             a['opening_balance'], a['credit_limit'], a['rate'], a['grace_days']),
        )
        acct_ids[key] = cur.lastrowid

    def service_account(name, kind):
        row = conn.execute('SELECT id FROM accounts WHERE name=?', (name,)).fetchone()
        if row:
            return row[0]
        return conn.execute(
            "INSERT INTO accounts (name, kind, currency, opening_balance) VALUES (?,?,'RUB',0)",
            (name, kind),
        ).lastrowid

    cash_id = service_account(CASH_ACCOUNT, 'cash')

    def hinted_account(name):
        """Счёт, который банк назвал в описании перевода. Вклады заводим сразу
        с нужным типом, чтобы они попали на страницу «Вклады», а не в «Счета»."""
        for key, a in accounts.items():
            if a['name'].startswith(name):
                return acct_ids[key]
        row = conn.execute('SELECT id FROM accounts WHERE name=?', (name,)).fetchone()
        if row:
            return row[0]
        dep = DEPOSIT_ACCOUNTS.get(name)
        return conn.execute(
            """INSERT INTO accounts (name, kind, org, currency, opening_balance, deposit_type)
               VALUES (?,?,?,'RUB',0,?)""",
            (name, 'deposit' if dep else 'bank', name, dep),
        ).lastrowid

    stats = defaultdict(int)

    tx_ids = {}     # ext_id → id вставленной операции (нужно для связи возвратов)

    def insert(**kw):
        for k in ('to_account_id', 'category_id', 'interest_part', 'counterparty',
                  'note', 'refund_of'):
            kw.setdefault(k, None)
        kw.setdefault('is_refund', 0)
        try:
            cur = conn.execute(
                """INSERT INTO transactions
                   (kind, occurred_at, amount, account_id, to_account_id, category_id,
                    interest_part, counterparty, note, is_refund, refund_of, ext_id, source)
                   VALUES (:kind,:occurred_at,:amount,:account_id,:to_account_id,:category_id,
                           :interest_part,:counterparty,:note,:is_refund,:refund_of,
                           :ext_id,:source)""",
                kw,
            )
            tx_ids[kw['ext_id']] = cur.lastrowid
            return 1
        except sqlite3.IntegrityError:
            stats['пропущено: уже было в базе'] += 1
            return 0

    # ── операции ─────────────────────────────────────────────────────────────
    for op in sorted(ops, key=lambda o: o.dt):
        aid = acct_ids[op.acct]
        when = op.dt.strftime('%Y-%m-%d %H:%M:%S')
        src = f'import:{op.src}'

        # Рост кредитного лимита — не движение денег
        if op.limit_change:
            stats['пропущено: изменение кредитного лимита'] += 1
            continue

        # Проценты начисляются до платежа и увеличивают долг по карте
        if op.interest_paid:
            insert(kind='expense',
                   occurred_at=(op.dt - timedelta(minutes=1)).strftime('%Y-%m-%d %H:%M:%S'),
                   amount=op.interest_paid, account_id=aid, category_id=interest_cat,
                   interest_part=op.interest_paid, counterparty='Сбербанк',
                   note='Погашение процентов по кредитной карте',
                   ext_id=op.ext_id + ':interest', source=src)
            stats['проценты по кредитке'] += 1

        # Наличные — полноценный счёт: снятие переводит деньги с карты в кошелёк,
        # внесение возвращает обратно.
        if op.cash:
            a, b = (cash_id, aid) if op.income else (aid, cash_id)
            stats['наличные → перевод'] += insert(
                kind='transfer', occurred_at=when, amount=op.amount,
                account_id=a, to_account_id=b,
                note='Внесение наличных' if op.income else 'Снятие наличных',
                ext_id=op.ext_id, source=src)
            continue

        # Перевод самому себе
        if op.self_transfer:
            if id(op) in paired_in:
                stats['парный перевод (учтён со стороны отправителя)'] += 1
                continue
            partner = pair_of.get(id(op))
            if partner:
                to_id = acct_ids[partner.acct]
                same_bank = partner.src == op.src
                stats['перевод между своими счетами' if same_bank
                      else 'перевод между своими счетами (разные банки)'] += insert(
                    kind='transfer', occurred_at=when, amount=op.amount,
                    account_id=aid, to_account_id=to_id,
                    note='Перевод между своими счетами', ext_id=op.ext_id, source=src)
            elif op.target_hint:
                # Пары нет, но банк-получатель назван прямо в описании
                other = hinted_account(op.target_hint)
                a, b = (other, aid) if op.income else (aid, other)
                stats[f'перевод ↔ {op.target_hint}'] += insert(
                    kind='transfer', occurred_at=when, amount=op.amount,
                    account_id=a, to_account_id=b,
                    note=f'Перевод между своими счетами ({op.target_hint})',
                    ext_id=op.ext_id, source=src)
            else:
                # Пары нет ни в одной выписке. Других банков у владельца нет,
                # значит это обычный перевод человеку, просто банк не назвал кого.
                kind = 'income' if op.income else 'expense'
                stats['перевод без пары → обычная операция'] += insert(
                    kind=kind, occurred_at=when, amount=op.amount, account_id=aid,
                    category_id=categorize(op.desc, rules, kind,
                                           other_inc if op.income else transfer_exp),
                    counterparty=op.counterparty, note=op.bank_cat,
                    ext_id=op.ext_id, source=src)
            continue

        # Возврат покупки — приход, привязанный к исходному расходу
        orig = refunds.get(id(op))
        if orig is not None:
            stats['возврат покупки'] += insert(
                kind='income', occurred_at=when, amount=op.amount, account_id=aid,
                category_id=other_inc, counterparty=op.counterparty,
                note=f'Возврат: {op.bank_cat}', is_refund=1,
                refund_of=tx_ids.get(orig.ext_id),
                ext_id=op.ext_id, source=src)
            continue

        # Обычный приход или расход
        kind = 'income' if op.income else 'expense'
        fallback = other_inc if op.income else other_exp
        # Категорию ищем и по описанию, и по категории банка — у Т-Банка она осмысленная
        cat = categorize(f'{op.desc} {op.bank_cat}', rules, kind, fallback)
        stats[kind] += insert(
            kind=kind, occurred_at=when, amount=op.amount, account_id=aid,
            category_id=cat, counterparty=op.counterparty, note=op.bank_cat,
            ext_id=op.ext_id, source=src)

    conn.commit()

    print('\n── Импортировано ──')
    for k, v in sorted(stats.items(), key=lambda kv: -kv[1]):
        print(f'  {k:48} {v:>5}')

    # ── сверка с банком ──────────────────────────────────────────────────────
    # Детализация не всегда сходится с итоговым остатком: часть комиссий банк
    # списывает, не показывая строкой. Вместо молчаливого расхождения ставим
    # явную корректировку — тогда остаток совпадает с тем, что видно в банке.
    print('\n── Сверка с остатком банка ──')
    for key, a in accounts.items():
        aid = acct_ids[key]
        mine = conn.execute('SELECT balance FROM account_balances WHERE id=?', (aid,)).fetchone()[0]

        if a['close_balance'] is None:
            # Банк не печатает итоговый остаток (Т-Банк, ВТБ). Выписка покрывает
            # не всю жизнь счёта, поэтому расхождение — это то, что было на счёте
            # ДО её начала. Это и есть начальный остаток, а не ошибка.
            expected = KNOWN_BALANCE.get(a['name'], 0.0)
            opening = round(expected - mine, 2)
            if abs(opening) >= 0.01:
                conn.execute('UPDATE accounts SET opening_balance=? WHERE id=?', (opening, aid))
                print(f"  {a['name']:32} нет итога в выписке → начальный остаток {opening:>+12,.2f}")
            else:
                print(f"  {a['name']:32} ✓ сходится: {mine:>12,.2f}")
            continue

        # У кредитки банк печатает доступный лимит, а мы храним долг со знаком минус
        expected = (a['close_balance'] - a['credit_limit']) if a['kind'] == 'credit' else a['close_balance']
        diff = round(expected - mine, 2)

        if abs(diff) < 0.01:
            print(f"  {a['name']:32} ✓ сходится: {mine:>12,.2f}")
            continue

        # Детализация не сходится с остатком: часть комиссий банк списывает,
        # не показывая их отдельной строкой. Ставим явную корректировку.
        insert(kind='income' if diff > 0 else 'expense',
               occurred_at=a['close_date'].strftime('%Y-%m-%d %H:%M:%S'),
               amount=abs(diff), account_id=aid,
               category_id=fix_inc if diff > 0 else fix_exp,
               counterparty=a['org'],
               note='Комиссии, не показанные в детализации выписки',
               ext_id=f"{key}:reconcile:{a['close_date']:%Y-%m-%d}", source='import:reconcile')
        print(f"  {a['name']:32} расхождение {diff:>+10,.2f} → корректировка")

    # Счета, которых нет в выписках, но остаток известен (например, брокерский)
    for name, expected in KNOWN_BALANCE.items():
        row = conn.execute(
            'SELECT id, balance FROM account_balances WHERE name=?', (name,)
        ).fetchone()
        if not row:
            continue
        aid, mine = row
        opening = round(expected - mine, 2)
        if abs(opening) >= 0.01:
            conn.execute('UPDATE accounts SET opening_balance=? WHERE id=?', (opening, aid))
            print(f'  {name:32} остаток известен → начальный остаток {opening:>+12,.2f}')

    conn.commit()

    print('\n── Остатки в приложении ──')
    for name, bal, kind, limit in conn.execute(
        'SELECT name, balance, kind, credit_limit FROM account_balances ORDER BY kind, name'
    ):
        if kind == 'credit':
            debt = -bal if bal < 0 else 0
            print(f'  {name:32} долг {debt:>12,.2f}  (доступно {(limit or 0) - debt:,.2f})')
        else:
            print(f'  {name:32} остаток {bal:>12,.2f}')

    conn.close()


if __name__ == '__main__':
    main()
