// Компиляция шейдеров с внятными сообщениями об ошибках и кэшем
// локаций uniform-переменных.

const compile = (gl, type, src, name) => {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || '';
    const kind = type === gl.VERTEX_SHADER ? 'вершинный' : 'фрагментный';
    // Печатаем исходник с номерами строк — иначе ошибку не найти.
    const listing = src.split('\n')
      .map((l, i) => String(i + 1).padStart(3) + ' | ' + l)
      .join('\n');
    gl.deleteShader(sh);
    throw new Error(`${name}: ${kind} шейдер не собрался\n${log}\n${listing}`);
  }
  return sh;
};

export function buildProgram(gl, name, vsSrc, fsSrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, name);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, name);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) || '';
    gl.deleteProgram(prog);
    throw new Error(`${name}: программа не слинковалась\n${log}`);
  }

  const cache = new Map();
  return {
    name,
    prog,
    use() { gl.useProgram(prog); },
    // getUniformLocation — не бесплатный вызов, поэтому кэшируем.
    loc(uniform) {
      if (cache.has(uniform)) return cache.get(uniform);
      const l = gl.getUniformLocation(prog, uniform);
      cache.set(uniform, l);
      return l;
    },
    attrib(a) { return gl.getAttribLocation(prog, a); },
  };
}
