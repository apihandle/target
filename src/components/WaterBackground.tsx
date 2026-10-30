"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Full-screen realistic moving-water background: a night lake surface with
 * rippling crests and warm golden light glints (WebGL),
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
float height(vec2 p, float t){
  vec2 q = vec2(p.x * 0.55, p.y * 1.8);
  float h = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    h += a * noise(q + vec2(t * 0.15 * (fi + 1.0), -t * (0.35 + 0.12 * fi)));
    q = q * 2.07 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  h += 0.08 * sin(p.y * 2.6 - t * 0.9 + sin(p.x * 0.7) * 1.2);
  return h;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  float horizon = 1.55;
  float depth = 1.0 / (horizon - uv.y);
  vec2 p = vec2((uv.x - 0.5) * aspect * depth * 2.2, depth * 4.2);
  float t = u_time;

  float e = 0.02 * depth;
  float h  = height(p, t);
  float hx = height(p + vec2(e, 0.0), t) - h;
  float hy = height(p + vec2(0.0, e), t) - h;
  vec2 g = vec2(hx, hy) / e;

  // facet facing viewer reflects the brighter sky; facing away reflects dark water
  float tilt = g.y * 0.30 / depth;
  float sky = clamp(0.5 + tilt * 1.1, 0.0, 1.0);

  vec3 dark = vec3(0.020, 0.032, 0.042);
  vec3 lit  = vec3(0.17, 0.25, 0.31);
  vec3 col = mix(dark, lit, smoothstep(0.15, 0.95, sky));

  // golden glints: distant lights reflected on crests, concentrated toward the top and right
  float cols = smoothstep(0.25, 0.70, noise(vec2(uv.x * 6.0 + 3.0, 0.5)));
  float lights = smoothstep(0.30, 0.90, uv.y) * cols * 1.2;
  lights += 0.8 * smoothstep(0.6, 1.0, uv.x) * smoothstep(0.2, 0.65, uv.y) * smoothstep(0.3, 0.7, noise(vec2(uv.x * 9.0, uv.y * 4.0)));
  float crest = smoothstep(0.70, 0.95, sky) * smoothstep(0.25, 0.65, noise(p * vec2(2.5, 9.0) + vec2(0.0, -t * 0.8)));
  float glint = crest * clamp(lights, 0.0, 1.0);
  col += vec3(0.95, 0.66, 0.30) * glint * 1.1;

  // haze toward the horizon, darker foreground
  col = mix(col, vec3(0.10, 0.13, 0.15), smoothstep(0.75, 1.0, uv.y) * 0.25);
  col *= mix(0.65, 1.0, smoothstep(0.0, 0.6, uv.y));
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
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-black/30" />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10"
        style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.6) 100%)" }}
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
