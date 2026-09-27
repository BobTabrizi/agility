"use client";

import { useMemo, type CSSProperties } from "react";
import { CHART_PALETTE, seededRandom } from "@/lib/chartPalette";

/**
 * A one-off confetti burst from the center of its (relatively positioned)
 * parent, for a Wheel/Plinko winner. Seeded by the result's id, so it's
 * stable across re-renders; keyed by it too, so a new result bursts again.
 * Uses the `wheel-confetti` keyframes in globals.css (off under reduced motion).
 */
export function Confetti({ seed, originY = "50%" }: { seed: string; originY?: string }) {
  const pieces = useMemo(() => {
    const rand = seededRandom(seed);
    return Array.from({ length: 28 }, (_, i) => {
      const angle = rand() * Math.PI * 2;
      const distance = 90 + rand() * 90;
      return {
        key: `${seed}-${i}`,
        style: {
          "--dx": `${Math.cos(angle) * distance}px`,
          "--dy": `${Math.sin(angle) * distance - 40}px`,
          "--spin": `${rand() * 720 - 360}deg`,
          animationDelay: `${rand() * 120}ms`,
          background: CHART_PALETTE[i % CHART_PALETTE.length].fill,
          animation: "wheel-confetti 1.1s ease-out forwards",
        } as CSSProperties,
      };
    });
  }, [seed]);

  return (
    <div aria-hidden className="pointer-events-none absolute left-1/2" style={{ top: originY }}>
      {pieces.map((piece) => (
        <span key={piece.key} className="wheel-motion absolute h-2.5 w-1.5 rounded-sm opacity-0" style={piece.style} />
      ))}
    </div>
  );
}
