"""Парсер PDF-справки о движении средств Озон Банка.

В одном файле бывает несколько счетов: у каждого своя шапка («Номер лицевого
счёта … Входящий остаток») и свой блок операций, закрытый строкой
«Исходящий остаток».
"""

import glob
import os
import re
from datetime import datetime

from pypdf import PdfReader

from .common import Op

BANK = 'Озон Банк'
SELF = 'Никита Александрович Е'   # так Озон подписывает переводы от самого себя

# Дата+время, номер документа, назначение (многострочное), сумма со знаком.
OP_RE = re.compile(
    r'(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})\s+(\d+)\s+(.*?)'
    r'([-+])\s*([\d\s ]+[.,]\d{2})\s*₽',
    re.S,
)

ACCT_RE = re.compile(r'Номер лицевого счёта:\s*№?\s*(\d+)')
CLOSE_RE = re.compile(r'Исходящий остаток:\s*([\d\s ]+[.,]\d{2})\s*₽')


def _money(s):
    return float(re.sub(r'[^\d.,]', '', s).replace(',', '.'))


def parse(path):
    reader = PdfReader(path)
    text = '\n'.join(p.extract_text() or '' for p in reader.pages)

    accounts, ops = [], []

    # Режем документ на блоки по счетам: от одного «Номер лицевого счёта» до следующего.
    marks = [m.start() for m in ACCT_RE.finditer(text)]
    if not marks:
        return [], []
    marks.append(len(text))

    for i in range(len(marks) - 1):
        block = text[marks[i]:marks[i + 1]]
        acct = ACCT_RE.search(block).group(1)

        closes = CLOSE_RE.findall(block)
        close_balance = _money(closes[-1]) if closes else None

        block_ops = []
        for m in OP_RE.finditer(block):
            date, time, doc, purpose, sign, amount = m.groups()
            dt = datetime.strptime(f'{date} {time}', '%d.%m.%Y %H:%M:%S')
            purpose = re.sub(r'\s+', ' ', purpose).strip()
            amt = _money(amount)
            if amt == 0:
                continue

            block_ops.append(Op(
                src='ozon',
                acct=acct,
                dt=dt,
                amount=amt,
                income=(sign == '+'),
                desc=purpose,
                counterparty=_counterparty(purpose),
                bank_cat=_bank_cat(purpose),
                ext_id=f'ozon:{acct}:{doc}:{sign}{amt}',
                self_transfer=SELF in purpose,
            ))

        if not block_ops:
            continue

        ops.extend(block_ops)
        accounts.append({
            'key': acct,
            # Счетов может быть несколько — различаем их хвостом номера
            'name': f'Озон Банк ···{acct[-4:]}',
            'kind': 'bank',
            'org': BANK,
            'number': acct,
            'card_last4': None,
            'opening_balance': 0.0,       # в справке входящий остаток всегда 0.00
            'credit_limit': None,
            'rate': None,
            'grace_days': None,
            'close_date': max(o.dt for o in block_ops),
            'close_balance': close_balance,
            'period_start': min(o.dt for o in block_ops),
        })

    return accounts, ops


def _bank_cat(purpose):
    if 'Оплата товаров' in purpose:
        return 'Покупки на Ozon'
    if 'Перевод' in purpose:
        return 'Перевод'
    if 'ешбэк' in purpose or 'Cashback' in purpose:
        return 'Кэшбэк'
    return 'Прочее'


def _counterparty(purpose):
    m = re.search(r'Отправитель:\s*(.+?)(?:\.|$)', purpose)
    if m:
        return m.group(1).strip()
    if 'Оплата товаров' in purpose:
        return 'Ozon'
    return None


def files(root='.'):
    out = []
    for pat in ('*озон*.pdf', '*ozon*.pdf', '*Озон*.pdf'):
        out.extend(glob.glob(os.path.join(root, pat)))
    return sorted(set(out))
