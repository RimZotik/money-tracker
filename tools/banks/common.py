"""Общее для всех банковских парсеров: нормализованная операция и разбор сумм."""

import os
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

# Суммы приходят с неразрывными и узкими пробелами как разделителями тысяч.
# Минус обязателен в шаблоне: остаток по счёту бывает отрицательным (овердрафт),
# и без знака такие строки не распознаются, а операция молча теряется.
MONEY = r'-?[\d   ]+,\d{2}'


def clean_money(s: str) -> float:
    neg = s.strip().startswith('-')
    v = float(re.sub(r'[^\d,]', '', s).replace(',', '.'))
    return -v if neg else v


@dataclass
class Op:
    """Операция в едином виде — независимо от того, из какого банка пришла."""

    src: str                    # 'sber' | 'ozon' | 'tbank'
    acct: str                   # ключ счёта (номер счёта или иной идентификатор)
    dt: datetime
    amount: float               # всегда > 0, направление задаёт income
    income: bool
    desc: str
    counterparty: Optional[str]
    bank_cat: str               # категория, как её назвал банк
    ext_id: str                 # ключ дедупликации при повторном импорте

    # Признаки, которые парсер банка вычисляет сам
    self_transfer: bool = False     # перевод самому себе
    cash: bool = False              # снятие или внесение наличных
    limit_change: bool = False      # изменение кредитного лимита — это не деньги
    interest_paid: Optional[float] = None   # проценты, погашенные вместе с платежом

    # Остаток по счёту после операции, как его напечатал банк. Нужен для сверки:
    # итоговый остаток из шапки выписки бывает неактуальным, а этот — нет.
    balance_after: Optional[float] = None

    # Счёт, на который явно указывает описание («Перевод в Ozon Bank»,
    # «TINKOFF INVESTMENT»). Заполняется, когда банк назвал получателя.
    target_hint: Optional[str] = None

    # Код авторизации. Возврат покупки банк проводит с тем же кодом, что и саму
    # покупку — по нему возврат надёжно связывается с исходным расходом.
    auth: Optional[str] = None


DB_PATH = os.path.join(os.environ['APPDATA'], 'com.rimzo.money-tracker', 'money.db')
