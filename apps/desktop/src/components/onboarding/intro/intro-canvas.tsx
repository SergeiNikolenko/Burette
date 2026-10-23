import { useLayoutEffect, useRef } from "react";
import { atomFragment, vertexShader } from "./atom-scene";

type Program = {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  uniforms: Record<"res" | "time" | "a" | "b" | "dark", WebGLUniformLocation | null>;
};

type Props = {
  time: number;
  params: readonly number[];
  /** 0 for the light theme, 1 for the dark one. */
  dark: number;
  width: number;
  height: number;
  dpr: number;
  /** WebGL 2 is missing or the shader failed: the opening cannot be drawn. */
  onUnavailable: () => void;
};

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL could not create a shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "shader compilation failed";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function createProgram(canvas: HTMLCanvasElement): Program {
  const gl = canvas.getContext("webgl2", {
    alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
    powerPreference: "high-performance",
  });
  if (!gl) throw new Error("WebGL 2 is unavailable");
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexShader);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, atomFragment);
  const program = gl.createProgram();
  const vao = gl.createVertexArray();
  if (!program || !vao) throw new Error("WebGL could not create the program");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "shader link failed");
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  return { gl, program, vao, uniforms: { res: uniform("uRes"), time: uniform("uTime"), a: uniform("uA"), b: uniform("uB"), dark: uniform("uDark") } };
}

/** A transparent full-window canvas that draws the opening at `time`. */
export function IntroCanvas({ time, params, dark, width, height, dpr, onUnavailable }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const program = useRef<Program | null>(null);
  const unavailable = useRef(onUnavailable);
  useLayoutEffect(() => { unavailable.current = onUnavailable; }, [onUnavailable]);
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));

  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    try {
      program.current = createProgram(element);
    } catch (error) {
      console.warn("[Burette] the opening cannot be drawn", error);
      unavailable.current();
      return;
    }
    // A lost context ends the opening rather than leaving the window empty.
    const lost = (event: Event) => {
      event.preventDefault();
      program.current = null;
      unavailable.current();
    };
    element.addEventListener("webglcontextlost", lost);
    return () => {
      element.removeEventListener("webglcontextlost", lost);
      const current = program.current;
      if (current && !current.gl.isContextLost()) {
        current.gl.deleteVertexArray(current.vao);
        current.gl.deleteProgram(current.program);
      }
      program.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const current = program.current;
    if (!current) return;
    const { gl, uniforms } = current;
    const value = (index: number) => params[index] ?? 0;
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.useProgram(current.program);
    gl.uniform2f(uniforms.res, pixelWidth, pixelHeight);
    gl.uniform1f(uniforms.time, time);
    gl.uniform4f(uniforms.a, value(0), value(1), value(2), value(3));
    gl.uniform4f(uniforms.b, value(4), value(5), value(6), value(7));
    gl.uniform1f(uniforms.dark, dark);
    gl.bindVertexArray(current.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  });

  return <canvas ref={canvas} width={pixelWidth} height={pixelHeight} className="absolute inset-0 block size-full" />;
}
