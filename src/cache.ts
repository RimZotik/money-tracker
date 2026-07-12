/**
 * Кэш ответов бэкенда.
 *
 * Зачем: журнал на 4500 операций тяжело считать при каждом переключении
 * страницы или смены фильтра. Раньше каждый переход заново дёргал SQL и
 * подвешивал интерфейс. Теперь одинаковый запрос отдаётся из памяти мгновенно,
 * а любое изменение данных сбрасывает кэш целиком — так он не может отстать
 * от базы.
 */

type Entry = { value: unknown; at: number };

const store = new Map<string, Entry>();
/** Запросы, которые уже летят: одинаковые склеиваются в один. */
const inflight = new Map<string, Promise<unknown>>();

/** Живём недолго: данные меняются редко, но устаревшие цифры хуже, чем лишний запрос. */
const TTL_MS = 60_000;

export async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;

  const running = inflight.get(key);
  if (running) return running as Promise<T>;

  const p = load()
    .then((value) => {
      store.set(key, { value, at: Date.now() });
      return value;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p as Promise<T>;
}

/** Данные изменились — весь кэш недействителен. */
export function invalidate(): void {
  store.clear();
  inflight.clear();
}
