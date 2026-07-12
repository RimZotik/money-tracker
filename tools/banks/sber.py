"""Парсер PDF-выписок Сбербанка (дебетовые карты и кредитная карта)."""

import os
import re
from datetime import datetime

from pypdf import PdfReader

from .common import Op, clean_money, MONEY

FOOTER = 'Дата формирования документа'
# Переводы самому себе: Сбер либо называет владельца, либо прямо пишет, что это
# перевод между собственными счетами.
SELF_MARKS = ('Никита Александрович', 'собственными счетами', 'своими счетами')
LIMIT_INCREASE = 'Увеличение кредитного лимита'

BANK = 'Сбербанк'


def parse_header(text):
    h = {}
    for key, pat in [
        ('account_no', r'Номер счёта\s+([\d\s]+)'),
        ('card', r'Карта\s+(.+)'),
        ('rate', r'Процентная ставка\s+([\d.]+)%'),
        ('grace', r'Льготный период\s+До (\d+)'),
    ]:
        m = re.search(pat, text)
        if m:
            h[key] = m.group(1).strip()
    m = re.search(r'Кредитный лимит\s+(' + MONEY + r')', text)
    if m:
        h['credit_limit'] = clean_money(m.group(1))
    m = re.search(r'Остаток на [\d.]+\s+(' + MONEY + r')\s*\nПополнение', text)
    if m:
        h['open_balance'] = clean_money(m.group(1))
    all_bal = re.findall(r'Остаток на ([\d.]+)\s+(' + MONEY + r')', text)
    if all_bal:
        h['close_date'] = datetime.strptime(all_bal[-1][0], '%d.%m.%Y')
        h['close_balance'] = clean_money(all_bal[-1][1])
    if 'account_no' in h:
        h['account_no'] = h['account_no'].replace(' ', '')
    return h


def _parse_debit(lines):
    op_re = re.compile(
        r'^(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})\s+(.+?)\s+(\+?' + MONEY + r')\s+(' + MONEY + r')$'
    )
    desc_re = re.compile(r'^(\d{2}\.\d{2}\.\d{4})\s+(\d{6})\s*(.*)$')
    ops, cur = [], None
    for ln in lines:
        m = op_re.match(ln)
        if m:
            if cur:
                ops.append(cur)
            date, time, cat, amount, bal = m.groups()
            cur = {
                'date': date, 'time': time, 'bank_cat': cat.strip(),
                'amount': abs(clean_money(amount)), 'income': amount.startswith('+'),
                'balance': clean_money(bal), 'desc': '', 'auth': '',
            }
            continue
        m = desc_re.match(ln)
        if m and cur:
            cur['auth'] = m.group(2)
            cur['desc'] = (cur['desc'] + ' ' + m.group(3)).strip()
            continue
        if cur and ln.strip() and 'Страница' not in ln and not ln.startswith('Выписка по счёту'):
            cur['desc'] = (cur['desc'] + ' ' + ln.strip()).strip()
    if cur:
        ops.append(cur)
    return ops


def _parse_credit(lines):
    date_re = re.compile(r'^(\d{2}\.\d{2}\.\d{4})$')
    time_re = re.compile(r'^(\d{2}:\d{2})$')
    auth_re = re.compile(r'^(\d{6})$')
    tail_re = re.compile(r'^(\+?' + MONEY + r')\s+(' + MONEY + r')$')
    interest_re = re.compile(r'^Погашение процентов\s+(' + MONEY + r')$')

    ops, i = [], 0
    while i < len(lines):
        ln = lines[i].strip()
        m = interest_re.match(ln)
        if m and ops:
            ops[-1]['interest_paid'] = clean_money(m.group(1))
            i += 1
            continue
        if date_re.match(ln) and i + 3 < len(lines):
            d1, d2, t, a = ln, lines[i + 1].strip(), lines[i + 2].strip(), lines[i + 3].strip()
            if date_re.match(d2) and time_re.match(t) and auth_re.match(a):
                j = i + 4
                cat = lines[j].strip() if j < len(lines) else ''
                j += 1
                desc, amount, bal = [], None, None
                while j < len(lines):
                    cand = lines[j].strip()
                    mt = tail_re.match(cand)
                    if mt:
                        amount, bal = mt.groups()
                        j += 1
                        break
                    mt2 = re.match(r'^(.*?)\s+(\+?' + MONEY + r')\s+(' + MONEY + r')$', cand)
                    if mt2:
                        desc.append(mt2.group(1))
                        amount, bal = mt2.group(2), mt2.group(3)
                        j += 1
                        break
                    if date_re.match(cand):
                        break
                    desc.append(cand)
                    j += 1
                if amount:
                    ops.append({
                        'date': d1, 'time': t, 'auth': a, 'bank_cat': cat,
                        'desc': ' '.join(desc).strip(), 'amount': abs(clean_money(amount)),
                        'income': amount.startswith('+'), 'balance': clean_money(bal),
                    })
                i = j
                continue
        i += 1
    return ops


def _merchant(desc):
    d = re.sub(r'\.?\s*Операция по карте.*', '', desc)
    d = re.sub(r'Покупка по СБП в ТСТ другого банка\.*', '', d)
    return re.sub(r'\s+', ' ', d).strip(' .')


# Банки, которые Сбер иногда называет прямо в описании перевода. Такие переводы
# тоже свои — их надо склеивать с выписками этих банков, а не считать тратой.
# Порядок важен: INVESTMENT проверяется раньше, чем TINKOFF.
TARGET_HINTS = [
    ('TINKOFF INVESTMENT', 'Т-Инвестиции'),
    ('T-INVESTMENT',       'Т-Инвестиции'),
    ('TINKOFF',            'Т-Банк'),
    ('Ozon',               'Озон Банк'),
    ('VTB',                'ВТБ'),
]


def _target_hint(desc, bank_cat):
    if 'Перевод' not in bank_cat and 'Перевод' not in desc:
        return None
    for needle, name in TARGET_HINTS:
        if needle.lower() in desc.lower():
            return name
    return None


def parse(path):
    """→ (accounts, ops). accounts — список описаний счетов, ops — нормализованные операции."""
    reader = PdfReader(path)
    pages = [p.extract_text() or '' for p in reader.pages]
    h = parse_header(pages[0])
    is_credit = 'кредитной карты' in pages[0]

    lines = []
    for p in pages:
        lines.extend(p.split('\n'))
    raw = _parse_credit(lines) if is_credit else _parse_debit(lines)

    acct = h['account_no']
    card = h.get('card', '')
    last4 = (re.search(r'(\d{4})\s*$', card) or [None, None])[1]

    account = {
        'key': acct,
        'name': (f'Кредитная СберКарта ···{last4}' if is_credit
                 else f'{card.split("••")[0].strip()} ···{last4}'),
        'kind': 'credit' if is_credit else 'bank',
        'org': BANK,
        'number': acct,
        'card_last4': last4,
        'opening_balance': 0 if is_credit else h.get('open_balance', 0),
        'credit_limit': h.get('credit_limit'),
        'rate': float(h['rate']) if h.get('rate') else None,
        'grace_days': int(h['grace']) if h.get('grace') else None,
        # для сверки: у кредитки банк печатает доступный лимит
        'close_date': h.get('close_date'),
        'close_balance': h.get('close_balance'),
        'period_start': None,
    }

    ops = []
    for idx, o in enumerate(raw):
        desc = o['desc']
        if FOOTER in desc:
            desc = desc.split(FOOTER)[0]
        desc = re.sub(r'\s+', ' ', desc).strip()

        dt = datetime.strptime(f"{o['date']} {o['time']}", '%d.%m.%Y %H:%M')
        sign = '+' if o['income'] else '-'
        limit_change = is_credit and (
            LIMIT_INCREASE in desc or (o['bank_cat'] == 'Прочие операции' and desc.strip() in ('-', ''))
        )
        hint = _target_hint(desc, o['bank_cat'])

        ops.append(Op(
            src='sber',
            acct=acct,
            dt=dt,
            amount=o['amount'],
            income=o['income'],
            desc=desc,
            counterparty=_merchant(desc) or None,
            bank_cat=o['bank_cat'],
            ext_id=f"sber:{acct}:{o['date']}:{o['time']}:{o.get('auth','')}:{sign}{o['amount']}",
            # Перевод свой, если Сбер назвал владельца или прямо назвал банк-получатель
            self_transfer=any(m in desc for m in SELF_MARKS) or (hint is not None),
            cash=o['bank_cat'] in ('Выдача наличных', 'Внесение наличных'),
            limit_change=limit_change,
            interest_paid=o.get('interest_paid'),
            balance_after=o.get('balance'),
            target_hint=hint,
            auth=o.get('auth'),
        ))

    if ops:
        account['period_start'] = min(o.dt for o in ops)
        # Сверяться будем по остатку после ПОСЛЕДНЕЙ операции в детализации, а не
        # по «Остатку на …» из шапки: шапка бывает устаревшей (у карты 1510 она
        # показывает 8 105,53 при фактических 6 508,58).
        last = raw[0]                       # в PDF операции идут от новых к старым
        account['close_date'] = datetime.strptime(
            f"{last['date']} {last['time']}", '%d.%m.%Y %H:%M')
        account['close_balance'] = last.get('balance')

    return [account], ops


def files(root='.'):
    import glob
    return sorted(glob.glob(os.path.join(root, 'Выписка*.pdf')))
