import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

/**
 * Держит выпадающую панель внутри окна.
 *
 * Панель раскрывается вправо-вниз, но у правого края окна она уезжала за
 * границу и часть содержимого была недоступна. Здесь мы меряем реальные
 * размеры после отрисовки и, если места не хватает, прижимаем панель к правому
 * краю кнопки, а при нехватке места снизу — раскрываем вверх.
 */
export function usePopover(
  anchor: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  open: boolean
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const p = panel.current?.getBoundingClientRect();
      if (!a || !p) return;

      const M = 8; // зазор до края окна
      const next: CSSProperties = {};

      // По горизонтали: не вылезаем за правый край
      if (a.left + p.width > window.innerWidth - M) {
        next.left = "auto";
        next.right = 0;
      } else {
        next.left = 0;
        next.right = "auto";
      }

      // По вертикали: если снизу не помещается, а сверху места больше — вверх
      const below = window.innerHeight - a.bottom;
      if (below < p.height + M && a.top > below) {
        next.top = "auto";
        next.bottom = "calc(100% + 6px)";
      } else {
        next.top = "calc(100% + 6px)";
        next.bottom = "auto";
      }

      // На маленьком окне панель всё равно обязана помещаться
      next.maxHeight = `${window.innerHeight - 2 * M - 40}px`;
      next.maxWidth = `${window.innerWidth - 2 * M}px`;
      next.overflowY = "auto";

      setStyle(next);
    };

    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, anchor, panel]);

  return style;
}
