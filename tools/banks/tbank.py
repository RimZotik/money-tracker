"""Парсер CSV-выписки Т-Банка.

Формат: разделитель «;», кодировка utf-8-sig, суммы со знаком и запятой.
В отличие от Сбера, Т-Банк сам даёт вменяемую категорию и имя контрагента,
поэтому его категорию имеет смысл использовать как подсказку.
"""

import csv
import glob
import io
import os
import re
from datetime import datetime

from .common import Op

BANK = 'Т-Банк'

# Переводы самому себе Т-Банк подписывает именем владельца либо прямо называет
# их переводом между своими счетами.
SELF_NAMES = ('Никита Е.', 'Никита Александрович Е', 'Между своими счетами')

# Пополнение брокерского счёта — это не трата, а перевод на свой же счёт,
# который живёт на странице «Вклады».
INVEST_HINTS = ('Пополнение брокерского', 'Инвесткопилк', 'брокерского счета')
INVEST_ACCOUNT = 'Т-Инвестиции'

ACCOUNT_KEY = 'tbank-main'


def _money(s):
    return float(s.replace(' ', '').replace(' ', '').replace(',', '.'))


def parse(path):
    raw = open(path, 'rb').read().decode('utf-8-sig')
    rows = list(csv.DictReader(io.StringIO(raw), delimiter=';'))

    ops = []
    last4 = None
    for r in rows:
        # Неуспешные операции в баланс не попадают
        if (r.get('Статус') or '').strip() != 'OK':
            continue

        amount = _money(r['Сумма операции'])
        if amount == 0:
            continue

        dt = datetime.strptime(r['Дата операции'], '%d.%m.%Y %H:%M:%S')
        desc = (r.get('Описание') or '').strip()
        cat = (r.get('Категория') or '').strip()
        card = (r.get('Номер карты') or '').strip()
        if card:
            last4 = card.lstrip('*')

        invest = any(h in desc for h in INVEST_HINTS)

        ops.append(Op(
            src='tbank',
            acct=ACCOUNT_KEY,
            dt=dt,
            amount=abs(amount),
            income=amount > 0,
            desc=f'{cat}. {desc}'.strip('. '),
            counterparty=desc or None,
            bank_cat=cat,
            ext_id=f"tbank:{r['Дата операции']}:{amount}:{desc[:20]}",
            self_transfer=invest or any(n in desc for n in SELF_NAMES),
            target_hint=INVEST_ACCOUNT if invest else None,
        ))

    if not ops:
        return [], []

    account = {
        'key': ACCOUNT_KEY,
        'name': f'Т-Банк ···{last4}' if last4 else 'Т-Банк',
        'kind': 'bank',
        'org': BANK,
        'number': None,
        'card_last4': last4,
        'opening_balance': 0.0,
        'credit_limit': None,
        'rate': None,
        'grace_days': None,
        # В CSV нет итогового остатка — сверять не с чем
        'close_date': None,
        'close_balance': None,
        'period_start': min(o.dt for o in ops),
    }
    return [account], ops


def files(root='.'):
    out = []
    for pat in ('*т банк*.csv', '*т-банк*.csv', '*tbank*.csv', '*tinkoff*.csv'):
        out.extend(glob.glob(os.path.join(root, pat)))
    return sorted(set(out))
