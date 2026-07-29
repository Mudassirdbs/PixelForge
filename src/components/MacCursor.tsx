import { useEffect, useRef, useState } from "react";

/**
 * macOS-style pointer that replaces the native cursor.
 * - Arrow by default
 * - Morphs to a "pointing hand" over interactive elements
 * - Morphs to an I-beam over text inputs
 * - Hidden on touch devices
 */
export default function MacCursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const [variant, setVariant] = useState<"arrow" | "pointer" | "text">("arrow");
  const [visible, setVisible] = useState(true);
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    // Skip on touch-primary devices
    if (window.matchMedia("(pointer: coarse)").matches) return;

    document.documentElement.classList.add("mac-cursor-active");

    let raf = 0;
    let x = window.innerWidth / 2, y = window.innerHeight / 2;
    let tx = x, ty = y;
    let primed = false;

    if (dotRef.current) {
      dotRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }

    const onMove = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      if (!primed) {
        // Snap to real cursor position on first move — no ease-in from center
        x = tx; y = ty;
        primed = true;
        if (dotRef.current) {
          dotRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        }
      }
      if (!visible) setVisible(true);

      const el = e.target as HTMLElement | null;
      if (el) {
        if (el.closest('input:not([type="button"]):not([type="submit"]), textarea, [contenteditable="true"]')) {
          setVariant((v) => (v === "text" ? v : "text"));
        } else if (
          el.closest(
            'a, button, [role="button"], label, select, summary, [data-cursor="pointer"], input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"], input[type="file"]'
          )
        ) {
          setVariant((v) => (v === "pointer" ? v : "pointer"));
        } else {
          setVariant((v) => (v === "arrow" ? v : "arrow"));
        }
      }
    };

    const onDown = () => setPressed(true);
    const onUp = () => setPressed(false);
    const onLeave = () => setVisible(false);
    const onEnter = () => setVisible(true);

    const tick = () => {
      x += (tx - x) * 0.35;
      y += (ty - y) * 0.35;
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("pointerenter", onEnter);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("pointerenter", onEnter);
      document.documentElement.classList.remove("mac-cursor-active");
    };
  }, [visible]);

  return (
    <div
      ref={dotRef}
      aria-hidden="true"
      className="mac-cursor"
      data-variant={variant}
      data-visible={visible ? "1" : "0"}
      data-pressed={pressed ? "1" : "0"}
    >
      {variant === "arrow" && (
        <svg width="22" height="22" viewBox="0 0 22 22" className="mac-cursor__svg">
          {/* macOS arrow: white fill, black stroke */}
          <path
            d="M3 2 L3 17 L7.2 13.2 L9.6 18.6 L11.8 17.6 L9.4 12.2 L15 12.2 Z"
            fill="#ffffff"
            stroke="#000000"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {variant === "pointer" && (
        <svg width="26" height="26" viewBox="0 0 26 26" className="mac-cursor__svg mac-cursor__svg--hand">
          {/* Simple pointing hand */}
          <path
            d="M10 3 v10 l-2.5 -1.5 c-1.2 -0.7 -2.6 0.9 -1.6 2 l5 5.4 c0.7 0.8 1.7 1.2 2.8 1.2 h3.5 c2.2 0 4 -1.8 4 -4 v-5 c0 -1.1 -0.9 -2 -2 -2 s-2 0.9 -2 2 v-1 c0 -1.1 -0.9 -2 -2 -2 s-2 0.9 -2 2 v-1 c0 -1.1 -0.9 -2 -2 -2 s-2 0.9 -2 2 v-6 c0 -1.1 -0.9 -2 -2 -2 s-2 0.9 -2 2 z"
            fill="#ffffff"
            stroke="#000000"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {variant === "text" && (
        <svg width="18" height="22" viewBox="0 0 18 22" className="mac-cursor__svg">
          <path
            d="M9 3 v16 M5 3 h8 M5 19 h8"
            stroke="#ffffff"
            strokeWidth="2.6"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M9 3 v16 M5 3 h8 M5 19 h8"
            stroke="#000000"
            strokeWidth="1.2"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      )}
    </div>
  );
}
