"use client";

/**
 * Dithered pixel field background.
 * Shader adapted from React Bits' PixelBlast (inspired by
 * github.com/zavalit/bayer-dithering-webgl-demo).
 *
 * The postprocessing passes (liquid / film noise) from the original are
 * intentionally omitted: they add two extra full-screen passes plus a CPU
 * canvas trail per frame, which is the single biggest cost of that component
 * and is invisible in a static composition. Everything here runs as one
 * fragment shader on a single fullscreen quad.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";

type PixelBlastVariant = "square" | "circle" | "triangle" | "diamond";

const SHAPE_MAP: Record<PixelBlastVariant, number> = {
  square: 0,
  circle: 1,
  triangle: 2,
  diamond: 3,
};

const VERTEX_SRC = /* glsl */ `
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

const FRAGMENT_SRC = /* glsl */ `
precision highp float;

uniform vec3  uColor;
uniform vec2  uResolution;
uniform float uTime;
uniform float uPixelSize;
uniform float uScale;
uniform float uDensity;
uniform float uPixelJitter;
uniform float uEdgeFade;

uniform int   uShapeType;
const int SHAPE_SQUARE   = 0;
const int SHAPE_CIRCLE   = 1;
const int SHAPE_TRIANGLE = 2;
const int SHAPE_DIAMOND  = 3;

out vec4 fragColor;

float Bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2. + a.y * a.y * .75);
}
#define Bayer4(a) (Bayer2(.5*(a))*0.25 + Bayer2(a))
#define Bayer8(a) (Bayer4(.5*(a))*0.25 + Bayer2(a))

#define FBM_OCTAVES     5
#define FBM_LACUNARITY  1.25
#define FBM_GAIN        1.0

float hash11(float n){ return fract(sin(n)*43758.5453); }

float vnoise(vec3 p){
  vec3 ip = floor(p);
  vec3 fp = fract(p);
  float n000 = hash11(dot(ip + vec3(0.0,0.0,0.0), vec3(1.0,57.0,113.0)));
  float n100 = hash11(dot(ip + vec3(1.0,0.0,0.0), vec3(1.0,57.0,113.0)));
  float n010 = hash11(dot(ip + vec3(0.0,1.0,0.0), vec3(1.0,57.0,113.0)));
  float n110 = hash11(dot(ip + vec3(1.0,1.0,0.0), vec3(1.0,57.0,113.0)));
  float n001 = hash11(dot(ip + vec3(0.0,0.0,1.0), vec3(1.0,57.0,113.0)));
  float n101 = hash11(dot(ip + vec3(1.0,0.0,1.0), vec3(1.0,57.0,113.0)));
  float n011 = hash11(dot(ip + vec3(0.0,1.0,1.0), vec3(1.0,57.0,113.0)));
  float n111 = hash11(dot(ip + vec3(1.0,1.0,1.0), vec3(1.0,57.0,113.0)));
  vec3 w = fp*fp*fp*(fp*(fp*6.0-15.0)+10.0);
  float x00 = mix(n000, n100, w.x);
  float x10 = mix(n010, n110, w.x);
  float x01 = mix(n001, n101, w.x);
  float x11 = mix(n011, n111, w.x);
  float y0  = mix(x00, x10, w.y);
  float y1  = mix(x01, x11, w.y);
  return mix(y0, y1, w.z) * 2.0 - 1.0;
}

float fbm2(vec2 uv, float t){
  vec3 p = vec3(uv * uScale, t);
  float amp = 1.0;
  float freq = 1.0;
  float sum = 1.0;
  for (int i = 0; i < FBM_OCTAVES; ++i){
    sum  += amp * vnoise(p * freq);
    freq *= FBM_LACUNARITY;
    amp  *= FBM_GAIN;
  }
  return sum * 0.5 + 0.5;
}

float maskCircle(vec2 p, float cov){
  float r = sqrt(cov) * .25;
  float d = length(p - 0.5) - r;
  float aa = 0.5 * fwidth(d);
  return cov * (1.0 - smoothstep(-aa, aa, d * 2.0));
}

float maskTriangle(vec2 p, vec2 id, float cov){
  bool flip = mod(id.x + id.y, 2.0) > 0.5;
  if (flip) p.x = 1.0 - p.x;
  float r = sqrt(cov);
  float d  = p.y - r*(1.0 - p.x);
  float aa = fwidth(d);
  return cov * clamp(0.5 - d/aa, 0.0, 1.0);
}

float maskDiamond(vec2 p, float cov){
  float r = sqrt(cov) * 0.564;
  return step(abs(p.x - 0.49) + abs(p.y - 0.49), r);
}

void main(){
  float pixelSize = uPixelSize;
  vec2 fragCoord = gl_FragCoord.xy - uResolution * .5;
  float aspectRatio = uResolution.x / uResolution.y;

  vec2 pixelId = floor(fragCoord / pixelSize);
  vec2 pixelUV = fract(fragCoord / pixelSize);

  float cellPixelSize = 8.0 * pixelSize;
  vec2 cellId = floor(fragCoord / cellPixelSize);
  vec2 cellCoord = cellId * cellPixelSize;
  vec2 uv = cellCoord / uResolution * vec2(aspectRatio, 1.0);

  float base = fbm2(uv, uTime * 0.05);
  base = base * 0.5 - 0.65;

  float feed = base + (uDensity - 0.5) * 0.3;

  float bayer = Bayer8(fragCoord / uPixelSize) - 0.5;
  float bw = step(0.5, feed + bayer);

  float h = fract(sin(dot(floor(fragCoord / uPixelSize), vec2(127.1, 311.7))) * 43758.5453);
  float jitterScale = 1.0 + (h - 0.5) * uPixelJitter;
  float coverage = bw * jitterScale;
  float M;
  if      (uShapeType == SHAPE_CIRCLE)   M = maskCircle (pixelUV, coverage);
  else if (uShapeType == SHAPE_TRIANGLE) M = maskTriangle(pixelUV, pixelId, coverage);
  else if (uShapeType == SHAPE_DIAMOND)  M = maskDiamond(pixelUV, coverage);
  else                                   M = coverage;

  if (uEdgeFade > 0.0) {
    vec2 norm = gl_FragCoord.xy / uResolution;
    float edge = min(min(norm.x, norm.y), min(1.0 - norm.x, 1.0 - norm.y));
    float fade = smoothstep(0.0, uEdgeFade, edge);
    M *= fade;
  }

  vec3 color = uColor;

  vec3 srgbColor = mix(
    color * 12.92,
    1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055,
    step(0.0031308, color)
  );

  fragColor = vec4(srgbColor, M);
}
`;

export type PixelBlastProps = {
  variant?: PixelBlastVariant;
  /** Base dot size in CSS pixels, scaled internally by the device pixel ratio. */
  pixelSize?: number;
  color?: string;
  patternScale?: number;
  patternDensity?: number;
  pixelSizeJitter?: number;
  /** Time scale of the drift. Low values read as ambient rather than busy. */
  speed?: number;
  edgeFade?: number;
  /** Hard ceiling on the render resolution. Fragment cost scales with its square. */
  maxPixelRatio?: number;
  /** Frame budget. A drifting backdrop does not need 60fps. */
  maxFps?: number;
  /** Halts the loop without tearing down the GL context. */
  paused?: boolean;
  className?: string;
};

export function PixelBlast({
  variant = "square",
  pixelSize = 4,
  color = "#4d76f2",
  patternScale = 3,
  patternDensity = 1.1,
  pixelSizeJitter = 0.4,
  speed = 0.35,
  edgeFade = 0.3,
  maxPixelRatio = 1,
  maxFps = 30,
  paused = false,
  className,
}: PixelBlastProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Read through a ref so toggling pause never rebuilds the GL context.
  const pausedRef = useRef(paused);
  const syncRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const canvas = document.createElement("canvas");
    let renderer: THREE.WebGLRenderer;

    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: false,
        // The dither pattern is deliberately aliased, so the integrated GPU is
        // the right target: it keeps laptops off the discrete GPU and off fans.
        powerPreference: "low-power",
      });
    } catch {
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
    renderer.setClearAlpha(0);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);

    const uniforms = {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uShapeType: { value: SHAPE_MAP[variant] },
      uPixelSize: { value: pixelSize * renderer.getPixelRatio() },
      uScale: { value: patternScale },
      uDensity: { value: patternDensity },
      uPixelJitter: { value: pixelSizeJitter },
      uEdgeFade: { value: edgeFade },
    };

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SRC,
      fragmentShader: FRAGMENT_SRC,
      uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      glslVersion: THREE.GLSL3,
    });
    const geometry = new THREE.PlaneGeometry(2, 2);
    const quad = new THREE.Mesh(geometry, material);
    scene.add(quad);

    const clock = new THREE.Clock(false);

    let raf = 0;
    let running = false;
    let onscreen = true;
    let contextLost = false;
    let lastFrameAt = 0;
    const frameBudget = maxFps > 0 ? 1000 / maxFps - 1 : 0;

    const setSize = () => {
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;
      renderer.setSize(width, height, false);
      uniforms.uResolution.value.set(
        renderer.domElement.width,
        renderer.domElement.height,
      );
      uniforms.uPixelSize.value = pixelSize * renderer.getPixelRatio();
    };

    const drawFrame = () => {
      uniforms.uTime.value = clock.getElapsedTime() * speed;
      renderer.render(scene, camera);
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);

      if (now - lastFrameAt < frameBudget) {
        return;
      }

      lastFrameAt = now;
      drawFrame();
    };

    const start = () => {
      if (running || contextLost) {
        return;
      }

      running = true;
      // Clock.start() resumes accumulated elapsed time, so pausing never
      // produces a visible jump in the drift.
      clock.start();
      raf = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (!running) {
        return;
      }

      running = false;
      clock.stop();
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const sync = () => {
      if (onscreen && !document.hidden && !pausedRef.current) {
        start();
      } else {
        stop();
      }
    };

    syncRef.current = sync;

    setSize();
    // Paint one frame immediately so the backdrop is never blank, even if the
    // element is scrolled out of view or the tab starts hidden.
    drawFrame();

    const resizeObserver = new ResizeObserver(() => {
      setSize();

      if (!running) {
        drawFrame();
      }
    });
    resizeObserver.observe(container);

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        onscreen = entries.some((entry) => entry.isIntersecting);
        sync();
      },
      { threshold: 0 },
    );
    intersectionObserver.observe(container);

    const onContextLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      stop();
      container.dataset.contextLost = "true";
    };

    canvas.addEventListener("webglcontextlost", onContextLost);
    document.addEventListener("visibilitychange", sync);
    sync();

    return () => {
      stop();
      syncRef.current = null;
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      document.removeEventListener("visibilitychange", sync);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();

      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [
    color,
    edgeFade,
    maxFps,
    maxPixelRatio,
    patternDensity,
    patternScale,
    pixelSize,
    pixelSizeJitter,
    speed,
    variant,
  ]);

  useEffect(() => {
    pausedRef.current = paused;
    syncRef.current?.();
  }, [paused]);

  return <div className={className} ref={containerRef} />;
}

export default PixelBlast;
