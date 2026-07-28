"use client";

import { type CSSProperties, type PointerEvent, type ReactNode } from "react";

type GlowColor = "blue" | "purple" | "green" | "red" | "orange";
type GlowSize = "sm" | "md" | "lg";

interface GlowCardProps {
  children: ReactNode;
  className?: string;
  glowColor?: GlowColor;
  size?: GlowSize;
  width?: string | number;
  height?: string | number;
  customSize?: boolean;
}

type GlowCardStyle = CSSProperties & Record<`--${string}`, string | number>;

const glowColorMap: Record<GlowColor, { base: number; spread: number }> = {
  blue: { base: 220, spread: 200 },
  purple: { base: 280, spread: 300 },
  green: { base: 120, spread: 200 },
  red: { base: 0, spread: 200 },
  orange: { base: 30, spread: 200 },
};

const sizeMap: Record<GlowSize, { width: number; height: number }> = {
  sm: { width: 192, height: 256 },
  md: { width: 256, height: 320 },
  lg: { width: 320, height: 384 },
};

export function GlowCard({
  children,
  className = "",
  glowColor = "blue",
  size = "md",
  width,
  height,
  customSize = false,
}: GlowCardProps) {
  const { base, spread } = glowColorMap[glowColor];
  const resolvedSize = sizeMap[size];

  function syncPointer(event: PointerEvent<HTMLDivElement>) {
    const { clientX: x, clientY: y, currentTarget } = event;

    currentTarget.style.setProperty("--x", x.toFixed(2));
    currentTarget.style.setProperty("--xp", (x / window.innerWidth).toFixed(2));
    currentTarget.style.setProperty("--y", y.toFixed(2));
    currentTarget.style.setProperty(
      "--yp",
      (y / window.innerHeight).toFixed(2),
    );
  }

  const styles: GlowCardStyle = {
    "--base": base,
    "--spread": spread,
    "--radius": "14",
    "--border": "2",
    "--backdrop": "hsl(222 18% 13% / 0.9)",
    "--backup-border": "hsl(220 16% 24% / 0.85)",
    "--size": "180",
    "--outer": "0.9",
    "--border-size": "calc(var(--border, 2) * 1px)",
    "--spotlight-size": "calc(var(--size, 150) * 1px)",
    "--hue": "calc(var(--base) + (var(--xp, 0) * var(--spread, 0)))",
    backgroundAttachment: "fixed",
    backgroundColor: "var(--backdrop, transparent)",
    backgroundImage: `radial-gradient(
      var(--spotlight-size) var(--spotlight-size) at
      calc(var(--x, 0) * 1px)
      calc(var(--y, 0) * 1px),
      hsl(var(--hue, 210) calc(var(--saturation, 100) * 1%) calc(var(--lightness, 62) * 1%) / var(--bg-spot-opacity, 0.08)), transparent
    )`,
    backgroundPosition: "50% 50%",
    backgroundSize:
      "calc(100% + (2 * var(--border-size))) calc(100% + (2 * var(--border-size)))",
    border: "var(--border-size) solid var(--backup-border)",
    touchAction: "none",
  };

  if (customSize) {
    if (width !== undefined) {
      styles.width = typeof width === "number" ? `${width}px` : width;
    }

    if (height !== undefined) {
      styles.height = typeof height === "number" ? `${height}px` : height;
    }
  } else {
    styles.width =
      width !== undefined
        ? typeof width === "number"
          ? `${width}px`
          : width
        : `${resolvedSize.width}px`;
    styles.height =
      height !== undefined
        ? typeof height === "number"
          ? `${height}px`
          : height
        : `${resolvedSize.height}px`;
  }

  return (
    <div
      className={`spotlight-card ${className}`}
      data-glow
      style={styles}
      onPointerMove={syncPointer}
    >
      <div className="spotlight-card__inner-glow" data-glow />
      {children}
    </div>
  );
}
