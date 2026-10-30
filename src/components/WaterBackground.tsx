"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Full-screen realistic moving-water background (WebGL caustics + slow swell),
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
#define TAU 6.28318530718
#define MAX_ITER 5

float caustic(vec2 uv, float time){
  vec2 p = uv * TAU - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < MAX_ITER; n++) {
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= float(MAX_ITER);
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res.y;
  vec2 q  = gl_FragCoord.xy / u_res;
  float time = u_time * 0.35 + 23.0;
  vec2 swell = vec2(sin(uv.y * 3.0 + time * 0.6), cos(uv.x * 2.5 + time * 0.5)) * 0.015;
  float c1 = caustic(uv * 0.9 + swell, time);
  float c2 = caustic(uv * 1.6 - swell * 1.5 + 0.37, time * 0.8);
  float light = c1 * 0.7 + c2 * 0.3;
  vec3 deep = vec3(0.01, 0.05, 0.09);
  vec3 mid  = vec3(0.03, 0.20, 0.30);
  vec3 col = mix(deep, mid, smoothstep(0.0, 1.2, q.y)) + vec3(0.45, 0.80, 0.95) * light * 0.55;
  gl_FragColor = vec4(col, 1.0);
}`;

function WaterCanvas({ playing }: { playing: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playingRef = useRef(playing);
  const [failed, setFailed] = useState(false);

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
      g.uniform1f(uTime, simTime);
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

  if (failed) {
    return <div data-testid="water-fallback" className="fixed inset-0 -z-20 bg-gradient-to-b from-[#02121c] via-[#06283a] to-[#0a3a4f]" />;
  }
  return <canvas ref={canvasRef} aria-hidden="true" data-testid="water-canvas" className="fixed left-0 top-0 -z-20 block h-full w-full" />;
}

export default function WaterBackground() {
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setPlaying(false);
  }, []);

  return (
    <>
      <WaterCanvas playing={playing} />
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-black/50" />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10"
        style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 35%, rgba(0,0,0,0.75) 100%)" }}
      />
      <button
        type="button"
        data-testid="water-toggle"
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? "Pause water motion" : "Play water motion"}
        aria-pressed={!playing}
        className="fixed bottom-5 right-5 z-40 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-md transition-all hover:bg-white/20"
      >
        {playing ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4 translate-x-[1px]" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" /></svg>
        )}
      </button>
    </>
  );
}
