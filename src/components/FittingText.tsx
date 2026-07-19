import { useLayoutEffect, useRef, useState } from "react";

type Props = {
  children: string;
  /** Preferred size when the text fits on one line. */
  maxPx?: number;
  /** Smallest size before allowing a line break. */
  minPx?: number;
};

/**
 * Prefer a single line: shrink font from maxPx → minPx to fit the container.
 * If it still overflows at minPx, wrap/break instead of shrinking further.
 */
export function FittingText({
  children,
  maxPx = 14,
  minPx = 11,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(maxPx);
  const [wrap, setWrap] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const fit = () => {
      const available = container.clientWidth;
      if (available <= 0) return;

      const probe = document.createElement("div");
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.style.pointerEvents = "none";
      probe.style.whiteSpace = "nowrap";
      probe.style.lineHeight = "1.3";
      probe.textContent = children;
      container.appendChild(probe);

      let size = maxPx;
      let fits = false;
      while (size >= minPx - 0.01) {
        probe.style.fontSize = `${size}px`;
        if (probe.scrollWidth <= available + 1) {
          fits = true;
          break;
        }
        size -= 0.5;
      }
      container.removeChild(probe);

      if (fits) {
        setFontSize(size);
        setWrap(false);
      } else {
        setFontSize(minPx);
        setWrap(true);
      }
    };

    fit();
    const ro = new ResizeObserver(() => fit());
    ro.observe(container);
    return () => ro.disconnect();
  }, [children, maxPx, minPx]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        minWidth: 0,
        maxWidth: "100%",
      }}
    >
      <div
        style={{
          fontSize: `${fontSize}px`,
          lineHeight: 1.3,
          whiteSpace: wrap ? "normal" : "nowrap",
          wordBreak: wrap ? "break-all" : "normal",
          overflowWrap: wrap ? "anywhere" : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
