"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

/**
 * three.js is ~150kB gzipped, so it must never sit in the initial bundle for a
 * decorative layer. This chunk is fetched only after the gate below passes and
 * the main thread has gone idle.
 */
const PixelBlast = dynamic(
  () => import("./pixel-blast").then((mod) => mod.PixelBlast),
  { ssr: false, loading: () => null },
);

type NavigatorWithHints = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
};

type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * A full-screen fragment shader is the wrong trade on hardware that cannot
 * absorb it. Everything rejected here still gets the CSS pattern, which costs
 * one composited layer and no frames.
 */
function canAffordShaderBackground() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return false;
  }

  // Touch-primary devices are both the most GPU-constrained and the most
  // battery-sensitive, and they never see the pointer affordances anyway.
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    return false;
  }

  // Narrow viewports — even with a fine pointer (dev tools, some tablets) —
  // are not worth a full-screen shader on a conversion page.
  if (window.matchMedia("(max-width: 760px)").matches) {
    return false;
  }

  const nav = navigator as NavigatorWithHints;

  if (nav.connection?.saveData) {
    return false;
  }

  // Cellular edges are the wrong place to download a WebGL chunk for décor.
  const effectiveType = nav.connection?.effectiveType;
  if (effectiveType === "slow-2g" || effectiveType === "2g" || effectiveType === "3g") {
    return false;
  }

  if (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency < 4) {
    return false;
  }

  if (typeof nav.deviceMemory === "number" && nav.deviceMemory < 4) {
    return false;
  }

  // The shader is GLSL3, so WebGL2 is a hard requirement.
  const probe = document.createElement("canvas");
  const gl = probe.getContext("webgl2");

  if (!gl) {
    return false;
  }

  gl.getExtension("WEBGL_lose_context")?.loseContext();

  return true;
}

export function SiteBackground({ paused = false }: { paused?: boolean }) {
  const [shaderEnabled, setShaderEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!canAffordShaderBackground()) {
      return;
    }

    const enable = () => {
      if (!cancelled) {
        setShaderEnabled(true);
      }
    };

    const win = window as WindowWithIdleCallback;
    let cancelSchedule: () => void;

    if (
      typeof win.requestIdleCallback === "function" &&
      typeof win.cancelIdleCallback === "function"
    ) {
      const cancelIdleCallback = win.cancelIdleCallback;
      const handle = win.requestIdleCallback(enable, { timeout: 2500 });
      cancelSchedule = () => cancelIdleCallback.call(win, handle);
    } else {
      const handle = window.setTimeout(enable, 1200);
      cancelSchedule = () => window.clearTimeout(handle);
    }

    return () => {
      cancelled = true;
      cancelSchedule();
    };
  }, []);

  return (
    <div aria-hidden="true" className="site-bg">
      <div
        className={`site-bg__dots${shaderEnabled ? " is-replaced" : ""}`}
      />
      {shaderEnabled ? (
        <PixelBlast
          className="site-bg__shader"
          color="#5b81f5"
          edgeFade={0.32}
          maxFps={30}
          maxPixelRatio={1}
          patternDensity={1.12}
          patternScale={3}
          paused={paused}
          pixelSize={4}
          pixelSizeJitter={0.45}
          speed={0.32}
          variant="square"
        />
      ) : null}
      <div className="site-bg__veil" />
      <div className="site-bg__glow" />
    </div>
  );
}
