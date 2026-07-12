"""Парсер CSV-выписки ВТБ («Список операций»).

Особенность: зарплата и стипендия сюда зачисляются, а через час-два уходят
переводом на основную карту Сбера («Между счетами»). Списание — это и есть
тот перевод, а не трата: общий матчер найдёт ему пару в выписке Сбера.
"""

import csv
import glob
import io
import os
from datetime import datetime

from .common import Op

BANK = 'ВТБ'
SELF_NAMES = ('Никита Александрович Е', 'Никита Е.')
ACCOUNT_KEY = 'vtb-main'


def _money(s):
    s = (s or '').replace('\xa0', '').replace(' ', '').replace(',', '.').strip()
    return float(s) if s else 0.0


def parse(path):
    raw = open(path, 'rb').read().decode('utf-8-sig')
    rows = list(csv.DictReader(io.StringIO(raw), delimiter=';'))

    ops, last4 = [], None
    for r in rows:
        status = (r.get('Статус операции') or '').strip()
        if status and status != 'Выполнено':
            continue

        amount = _money(r['Сумма в валюте счёта'])
        if amount == 0:
            continue

        dt = datetime.strptime(r['Дата и время операции'], '%d.%m.%Y %H:%M')
        name = (r.get('Наименование операции') or '').strip()
        op_type = (r.get('Тип операции') or '').strip()
        cat = (r.get('Категория') or '').strip()
        merch = (r.get('Наименование ТСП') or '').strip()
        acct_no = (r.get('Номер счёта/Кредитного договора') or '').strip()
        if acct_no:
            last4 = acct_no.lstrip('*')

        income = amount > 0
        # «Между счетами» + имя владельца в наименовании — перевод самому себе
        is_self = cat == 'Между счетами' or any(n in name for n in SELF_NAMES)

        ops.append(Op(
            src='vtb',
            acct=ACCOUNT_KEY,
            dt=dt,
            amount=abs(amount),
            income=income,
            desc=f'{name} {op_type} {cat}'.strip(),
            counterparty=merch or name or None,
            bank_cat=cat,
            ext_id=f"vtb:{r['Дата и время операции']}:{amount}:{name[:20]}",
            self_transfer=is_self,
        ))

    if not ops:
        return [], []

    account = {
        'key': ACCOUNT_KEY,
        'name': f'ВТБ ···{last4}' if last4 else 'ВТБ',
        'kind': 'bank',
        'org': BANK,
        'number': None,
        'card_last4': last4,
        'opening_balance': 0.0,
        'credit_limit': None,
        'rate': None,
        'grace_days': None,
        # В выгрузке нет итогового остатка — сверяемся с известным фактом (см. import_statements)
        'close_date': max(o.dt for o in ops),
        'close_balance': None,
        'period_start': min(o.dt for o in ops),
    }
    return [account], ops


def files(root='.'):
    out = []
    for pat in ('*втб*.csv', '*vtb*.csv', '*ВТБ*.csv'):
        out.extend(glob.glob(os.path.join(root, pat)))
    return sorted(set(out))
