/**
 * Индикатор загрузки. Тонкая полоска вверху окна, как в браузере: она не двигает
 * контент и не мигает пустотой, поэтому переключение страниц не выглядит рывком.
 */
export function TopBar({ active }: { active: boolean }) {
  return <div className={`topbar ${active ? "on" : ""}`} />;
}

/** Заглушка на месте будущего блока — чтобы страница не прыгала, когда данные придут. */
export function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: string }) {
  return <span className="skel" style={{ height, width }} />;
}

/** Скелет таблицы операций: рисуем ровно столько строк, сколько их будет. */
export function TableSkeleton({ rows = 8, cols = 7 }: { rows?: number; cols?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: cols }).map((__, j) => (
            <td key={j}>
              <Skeleton width={j === cols - 1 ? "40%" : j === 3 ? "80%" : "60%"} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}
