"use client";

import { motion } from "framer-motion";
import { type CSSProperties, useEffect, useRef } from "react";

interface AnimatedGradientBackgroundProps {
  startingGap?: number;
  Breathing?: boolean;
  gradientColors?: string[];
  gradientStops?: number[];
  animationSpeed?: number;
  breathingRange?: number;
  containerStyle?: CSSProperties;
  containerClassName?: string;
  topOffset?: number;
}

export default function AnimatedGradientBackground({
  startingGap = 125,
  Breathing = false,
  gradientColors = [
    "#0a0b0e",
    "#101522",
    "#17265a",
    "#4d76f2",
    "#0a0b0e",
  ],
  gradientStops = [35, 55, 68, 76, 100],
  animationSpeed = 0.02,
  breathingRange = 5,
  containerStyle = {},
  topOffset = 0,
  containerClassName = "",
}: AnimatedGradientBackgroundProps) {
  if (gradientColors.length !== gradientStops.length) {
    throw new Error(
      `GradientColors and GradientStops must have the same length. Received gradientColors length: ${gradientColors.length}, gradientStops length: ${gradientStops.length}`,
    );
  }

  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let animationFrame = 0;
    let width = startingGap;
    let directionWidth = 1;

    const setGradient = () => {
      const gradientStopsString = gradientStops
        .map((stop, index) => `${gradientColors[index]} ${stop}%`)
        .join(", ");

      const gradient = `radial-gradient(${width}% ${
        width + topOffset
      }% at 50% 20%, ${gradientStopsString})`;

      if (containerRef.current) {
        containerRef.current.style.background = gradient;
      }
    };

    const animateGradient = () => {
      if (width >= startingGap + breathingRange) {
        directionWidth = -1;
      }

      if (width <= startingGap - breathingRange) {
        directionWidth = 1;
      }

      if (!Breathing || prefersReducedMotion) {
        directionWidth = 0;
      }

      width += directionWidth * animationSpeed;
      setGradient();

      if (Breathing && !prefersReducedMotion) {
        animationFrame = requestAnimationFrame(animateGradient);
      }
    };

    animateGradient();

    return () => cancelAnimationFrame(animationFrame);
  }, [
    startingGap,
    Breathing,
    gradientColors,
    gradientStops,
    animationSpeed,
    breathingRange,
    topOffset,
  ]);

  return (
    <motion.div
      animate={{
        opacity: 1,
        scale: 1,
        transition: {
          duration: 1.8,
          ease: [0.25, 0.1, 0.25, 1],
        },
      }}
      className={`animated-gradient-background ${containerClassName}`}
      initial={{
        opacity: 0,
        scale: 1.35,
      }}
    >
      <div
        className="animated-gradient-background__surface"
        ref={containerRef}
        style={containerStyle}
      />
    </motion.div>
  );
}
