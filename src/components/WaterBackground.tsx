"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Full-screen realistic moving-water background (venice.ai-like): dark teal
 * night water with smooth glossy ripples, reflected sky, warm golden glints and
 * a far edge that fades into darkness (WebGL),
 * with a dark cinematic tint/vignette and a bottom-right pause/play toggle.
 * Falls back to a static deep-water gradient when WebGL is unavailable.
 * Starts paused for users who prefer reduced motion.
 */

const VERT = `attribute vec2 a_pos; void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;
uniform float u_time;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// smooth, glossy ripples: a few directional waves, domain-warped so crests wander like real water
float height(vec2 p, float t){
  vec2 w = vec2(noise(p * 0.35 + t * 0.05), noise(p * 0.35 + 7.3 - t * 0.04)) - 0.5;
  p += w * 2.2;
  float h = 0.0;
  h += 0.50 * sin(dot(p, vec2(0.10, 1.00)) * 1.6 - t * 0.9);
  h += 0.32 * sin(dot(p, vec2(0.55, 0.83)) * 2.3 - t * 1.1 + 1.3);
  h += 0.28 * sin(dot(p, vec2(-0.62, 0.78)) * 2.0 - t * 0.8 + 4.1);
  h += 0.16 * sin(dot(p, vec2(0.92, 0.38)) * 3.7 - t * 1.4 + 2.2);
  h += 0.12 * sin(dot(p, vec2(-0.30, 0.95)) * 5.1 - t * 1.7 + 0.7);
  h += 0.25 * (noise(p * 1.3 - vec2(0.0, t * 0.3)) - 0.5);
  return h;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  // camera low over the water: rows near the top are far away
  float horizon = 1.25;
  float depth = 1.0 / (horizon - uv.y);
  vec2 p = vec2((uv.x - 0.5) * aspect * depth * 6.0, depth * 13.0);
  float t = u_time;

  float e = 0.015 * depth;
  float h  = height(p, t);
  float gx = (height(p + vec2(e, 0.0), t) - h) / e;
  float gy = (height(p + vec2(0.0, e), t) - h) / e;

  // foreshortening: far ripples look flatter and finer
  float slope = 0.26 / depth;
  vec3 n = normalize(vec3(-gx * slope, 1.0, -gy * slope));
  vec3 v = normalize(vec3((uv.x - 0.5) * 0.6, -0.18 - (1.0 - uv.y) * 0.35, 1.0));
  vec3 r = reflect(v, n);

  // dark night sky: faint teal glow low on the horizon
  float sky = smoothstep(-0.05, 0.45, r.y);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, -v), 0.0), 5.0);
  vec3 deep = vec3(0.012, 0.035, 0.042);
  vec3 skyLow = vec3(0.19, 0.31, 0.34);
  vec3 skyHigh = vec3(0.03, 0.06, 0.07);
  vec3 refl = mix(skyLow, skyHigh, sky);
  vec3 col = mix(deep, refl, smoothstep(0.0, 0.9, fres * 1.6));

  // warm lights on a far shore -> glints stretched in vertical columns
  float lx = uv.x + r.x * 0.25;
  float colm = smoothstep(0.55, 0.85, noise(vec2(lx * 7.0, 1.7))) + 0.7 * smoothstep(0.6, 0.9, noise(vec2(lx * 13.0, 5.1)));
  float spec = pow(clamp(1.0 - abs(r.y - 0.03) * 6.0, 0.0, 1.0), 3.0);
  float glint = colm * spec * smoothstep(0.05, 0.45, uv.y);
  col += vec3(1.0, 0.72, 0.32) * glint * 1.3;

  // depth of field: far water sinks into darkness
  col *= mix(1.0, 0.0, smoothstep(0.80, 1.0, uv.y));
  col *= mix(0.75, 1.0, smoothstep(0.0, 0.4, uv.y));
  gl_FragColor = vec4(col, 1.0);
}
`;

function WaterCanvas({ playing }: { playing: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playingRef = useRef(playing);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => { playingRef.current = playing; }, [playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = canvas?.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" }) ?? null;
    } catch { gl = null; }
    if (!canvas || !gl) { setFailed(true); return; }
    const g = gl;

    const compile = (type: number, src: string) => {
      const s = g.createShader(type)!;
      g.shaderSource(s, src);
      g.compileShader(s);
      if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) ?? "shader error");
      return s;
    };

    let program: WebGLProgram;
    try {
      program = g.createProgram()!;
      g.attachShader(program, compile(g.VERTEX_SHADER, VERT));
      g.attachShader(program, compile(g.FRAGMENT_SHADER, FRAG));
      g.linkProgram(program);
      if (!g.getProgramParameter(program, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(program) ?? "link error");
    } catch (e) {
      console.error(e);
      setFailed(true);
      return;
    }
    g.useProgram(program);

    const buf = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, buf);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
    const loc = g.getAttribLocation(program, "a_pos");
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
    const uRes = g.getUniformLocation(program, "u_res");
    const uTime = g.getUniformLocation(program, "u_time");

    let simTime = 0;
    let last = performance.now();
    let raf = 0;

    const draw = () => {
      g.uniform2f(uRes, canvas.width, canvas.height);
      g.uniform1f(uTime, simTime * 0.6);
      g.drawArrays(g.TRIANGLES, 0, 3);
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        g.viewport(0, 0, w, h);
      }
      draw();
    };

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);
    window.addEventListener("resize", resize);
    resize();
    // first frame is on screen: fade the live water in over the poster
    requestAnimationFrame(() => setReady(true));

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (playingRef.current && !document.hidden) {
        simTime += dt;
        draw();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", resize);
      g.deleteBuffer(buf);
      g.deleteProgram(program);
    };
  }, []);

  return (
    <>
      {/* Poster: a still frame of the water, server-rendered so it shows instantly (like venice.ai) */}
      <div
        aria-hidden="true"
        data-testid={failed ? "water-fallback" : "water-poster"}
        className="fixed inset-0 -z-30 bg-[#05090c] bg-cover bg-center"
        style={{ backgroundImage: "url(/water-poster.webp)" }}
      />
      {!failed && (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          data-testid="water-canvas"
          className="fixed left-0 top-0 -z-20 block h-full w-full transition-opacity duration-[1500ms] ease-in-out"
          style={{ opacity: ready ? 1 : 0 }}
        />
      )}
    </>
  );
}

export default function WaterBackground() {
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setPlaying(false);
  }, []);

  return (
    <>
      <WaterCanvas playing={playing} />
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-black/15" />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10"
        style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.45) 100%)" }}
      />
      <button
        type="button"
        data-testid="water-toggle"
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? "Pause water motion" : "Play water motion"}
        aria-pressed={!playing}
        className="fixed bottom-6 right-6 z-40 flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white/70 backdrop-blur-md transition-all hover:bg-white/20 hover:text-white md:bottom-14 md:right-10"
      >
        {playing ? (
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-3 w-3 translate-x-[1px]" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" /></svg>
        )}
      </button>
    </>
  );
}
