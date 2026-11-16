/* Visualizzatore 360° stereoscopico (equirettangolare) con tour — WebGL2 + WebXR, senza dipendenze. */
(() => {
'use strict';

const $ = (id) => document.getElementById(id);
const canvas = $('gl');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, xrCompatible: true, powerPreference: 'high-performance' });
if (!gl) { $('errore').hidden = false; return; }
const QUEST = /OculusBrowser|Quest/i.test(navigator.userAgent);
if (QUEST) document.body.classList.add('quest');

/* ------------------------------------------------------------------ stato */
const DEFAULTS = { layout: 'auto', proiezione: '360', vista: 'mono', scambia: false, fov: 75 };
const S = Object.assign({}, DEFAULTS, { yaw: 0, pitch: 0, auto: false, w: 0, h: 0, nome: '', pronta: false });

try { Object.assign(S, JSON.parse(localStorage.getItem('v360') || '{}')); } catch (e) { /* storage non disponibile */ }
S.auto = false;
function salva() {
  try {
    localStorage.setItem('v360', JSON.stringify({
      layout: S.layout, proiezione: S.proiezione, vista: S.vista, scambia: S.scambia, fov: S.fov,
    }));
  } catch (e) { /* ignora */ }
}

/* ------------------------------------------------------------- matematica */
function perspective(fovY, aspect, n, f) {
  const t = 1 / Math.tan(fovY / 2), r = 1 / (n - f);
  return new Float32Array([t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (n + f) * r, -1, 0, 0, 2 * n * f * r, 0]);
}
function mul(a, b) { // a * b (column-major)
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); }
function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); }
function ruotaY(a, v) { const c = Math.cos(a), s = Math.sin(a); return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]]; } // = rotY(a) * v
function invert(m) {
  const a = m, o = new Float32Array(16);
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  det = 1 / det;
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return o;
}

/* ----------------------------------------------------------------- shader */
const MAX_HOT = 24;
const R_HOT = 0.075;

const VS = `#version 300 es
in vec2 aPos;
out vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform mat4 uInvPV;      // inversa di (proiezione * vista senza traslazione)
uniform sampler2D uTex;
uniform sampler2D uLab;   // atlante delle etichette (una riga per punto)
uniform vec4 uRegion;     // x, y, w, h della metà-occhio nell'immagine (v verso il basso)
uniform vec2 uTexel;      // mezzo texel in coordinate immagine
uniform float uSpan;      // 2*PI per 360°, PI per 180°
uniform vec4 uHot[${MAX_HOT}];    // punti di collegamento: xyz = direzione, w = 1 se evidenziato
uniform int uNHot;
uniform vec4 uCur;        // cursore (controller VR): xyz = direzione, w = attivo
uniform float uEdit;      // 1 in modalità modifica
uniform float uFade;      // dissolvenza tra scene
const float RH = ${R_HOT};   // raggio angolare dei punti (rad)
const float LH = 0.055;   // altezza etichetta (unità tangenti ≈ rad)
const float LW = LH * 8.0;
in vec2 vNdc;
out vec4 oColor;
const float PI = 3.14159265358979;
void main() {
  vec4 p = uInvPV * vec4(vNdc, 0.0, 1.0);
  vec3 d = normalize(p.xyz / p.w);
  float lon = atan(d.x, -d.z);
  vec2 uv = vec2(lon / uSpan + 0.5, acos(clamp(d.y, -1.0, 1.0)) / PI);

  // derivate senza salto alla giunzione (evita la linea sulla cucitura)
  vec2 uvB = vec2(fract(uv.x + 0.5) - 0.5, uv.y);
  vec2 dx1 = dFdx(uv), dx2 = dFdx(uvB), dy1 = dFdy(uv), dy2 = dFdy(uvB);
  vec2 gx = dot(dx1, dx1) < dot(dx2, dx2) ? dx1 : dx2;
  vec2 gy = dot(dy1, dy1) < dot(dy2, dy2) ? dy1 : dy2;

  vec2 tc = uRegion.xy + uv * uRegion.zw;
  if (uRegion.z < 0.99) tc.x = clamp(tc.x, uRegion.x + uTexel.x, uRegion.x + uRegion.z - uTexel.x);
  tc.y = clamp(tc.y, uRegion.y + uTexel.y, uRegion.y + uRegion.w - uTexel.y);

  vec3 c = textureGrad(uTex, tc, gx * uRegion.zw, gy * uRegion.zw).rgb;
  float m = (uv.x < 0.0 || uv.x > 1.0) ? 0.0 : 1.0;
  vec3 col = c * m;

  float aa = length(fwidth(d));
  vec3 tint = mix(vec3(0.2, 0.55, 1.0), vec3(1.0, 0.6, 0.15), uEdit);
  for (int i = 0; i < ${MAX_HOT}; i++) {
    if (i >= uNHot) break;
    vec4 h = uHot[i];
    float cs = dot(d, h.xyz);
    if (cs < 0.94) continue;              // lontano dal punto e dalla sua etichetta
    float R = RH * (1.0 + 0.18 * h.w);
    float a = acos(clamp(cs, -1.0, 1.0));
    float disc = 1.0 - smoothstep(R - aa, R + aa, a);
    float ring = disc * smoothstep(R * 0.78 - aa, R * 0.78 + aa, a);
    float dotc = 1.0 - smoothstep(R * 0.22 - aa, R * 0.22 + aa, a);
    col = mix(col, tint, (disc - ring) * (0.55 + 0.3 * h.w));
    col = mix(col, vec3(1.0), max(ring, dotc) * (0.85 + 0.15 * h.w));

    // etichetta con il nome della destinazione, sotto il punto, sul piano tangente
    vec3 rt = cross(h.xyz, vec3(0.0, 1.0, 0.0));
    float lr = length(rt);
    rt = lr > 1e-3 ? rt / lr : vec3(1.0, 0.0, 0.0);
    vec3 up = cross(rt, h.xyz);
    vec3 q = d / cs - h.xyz;
    float vc = -(R + 0.02 + LH * 0.5);
    vec2 luv = vec2(dot(q, rt) / LW + 0.5, (vc - dot(q, up)) / LH + 0.5);
    if (luv.x > 0.0 && luv.x < 1.0 && luv.y > 0.0 && luv.y < 1.0) {
      vec4 lab = textureLod(uLab, vec2(luv.x, (float(i) + luv.y) / ${MAX_HOT}.0), 0.0);
      col = mix(col, lab.rgb, lab.a * (0.8 + 0.2 * h.w));
    }
  }
  if (uCur.w > 0.5) {
    float a = acos(clamp(dot(d, uCur.xyz), -1.0, 1.0));
    float r = 1.0 - smoothstep(0.012 - aa, 0.012 + aa, a);
    float b = 1.0 - smoothstep(0.018 - aa, 0.018 + aa, a);
    col = mix(col, vec3(0.0), b * 0.6);
    col = mix(col, vec3(1.0), r);
  }
  oColor = vec4(col * uFade, 1.0);
}`;

function compila(tipo, src) {
  const s = gl.createShader(tipo);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const prog = gl.createProgram();
gl.attachShader(prog, compila(gl.VERTEX_SHADER, VS));
gl.attachShader(prog, compila(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
const U = {};
['uInvPV', 'uTex', 'uLab', 'uRegion', 'uTexel', 'uSpan', 'uHot', 'uNHot', 'uCur', 'uEdit', 'uFade'].forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });

const vao = gl.createVertexArray();
gl.bindVertexArray(vao);
const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
const aPos = gl.getAttribLocation(prog, 'aPos');
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

let tex = null;

/* ----------------------------------------------------- caricamento texture */
function layoutEffettivo() {
  if (S.layout !== 'auto') return S.layout;
  const r = S.w / S.h;
  if (S.proiezione === '180') return r <= 1.2 ? 'tb' : (r >= 1.5 ? 'sbs' : 'mono');
  return r <= 1.2 ? 'tb' : (r >= 3 ? 'sbs' : 'mono');
}
const NOMI_LAYOUT = { tb: 'Sopra/Sotto', sbs: 'Affiancato', mono: 'Mono' };

function regione(occhio) { // 0 = sinistro, 1 = destro
  const lay = layoutEffettivo();
  const e = S.scambia ? 1 - occhio : occhio;
  if (lay === 'tb') return [0, e * 0.5, 1, 0.5];
  if (lay === 'sbs') return [e * 0.5, 0, 0.5, 1];
  return [0, 0, 1, 1];
}

function caricaSorgente(src, nome) {
  let w = src.width, h = src.height;
  // sul Quest si limita la texture a 8192 px per non esaurire la memoria del browser
  const maxTex = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), QUEST ? 8192 : 16384);
  let nota = '';
  if (w > maxTex || h > maxTex) {
    const k = maxTex / Math.max(w, h);
    const c = document.createElement('canvas');
    c.width = Math.floor(w * k); c.height = Math.floor(h * k);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, c.width, c.height);
    src = c; nota = ` (ridotta da ${w}×${h} per il limite GPU ${maxTex})`;
    w = c.width; h = c.height;
  }
  if (tex) gl.deleteTexture(tex);
  tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const an = gl.getExtension('EXT_texture_filter_anisotropic');
  if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));

  S.w = w; S.h = h; S.nome = nome; S.pronta = true; S.nota = nota;
  $('vuoto').classList.add('nascosto');
  aggiornaStato();
}

/* ---------------------------------------------------- etichette dei punti */
const LAB_W = 512, LAB_H = 64;
const labCanvas = document.createElement('canvas');
labCanvas.width = LAB_W; labCanvas.height = LAB_H * MAX_HOT;
const labTex = gl.createTexture();
let labFirma = null;
gl.activeTexture(gl.TEXTURE1);
gl.bindTexture(gl.TEXTURE_2D, labTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, labCanvas);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.activeTexture(gl.TEXTURE0);

function aggiornaEtichette() {
  const sc = sceneCorrente();
  const nomi = sc ? sc.hot.slice(0, MAX_HOT).map((h) => { const d = sceneById(h.to); return d ? d.name : '?'; }) : [];
  const firma = nomi.join('\n');
  if (firma === labFirma) return;
  labFirma = firma;
  const x = labCanvas.getContext('2d');
  x.clearRect(0, 0, labCanvas.width, labCanvas.height);
  x.font = '600 32px system-ui, "Segoe UI", Roboto, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  nomi.forEach((n, i) => {
    let t = n;
    while (x.measureText(t).width > LAB_W - 64 && t.length > 2) t = t.slice(0, -2) + '…';
    const w = Math.min(LAB_W - 8, x.measureText(t).width + 40), cy = i * LAB_H + LAB_H / 2;
    x.fillStyle = 'rgba(10, 14, 20, 0.78)';
    x.beginPath();
    if (x.roundRect) x.roundRect((LAB_W - w) / 2, cy - 24, w, 48, 24); else x.rect((LAB_W - w) / 2, cy - 24, w, 48);
    x.fill();
    x.fillStyle = '#fff';
    x.fillText(t, LAB_W / 2, cy + 1);
  });
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, labTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, labCanvas);
  gl.activeTexture(gl.TEXTURE0);
}

/* ------------------------------------------------------- scene e collegamenti */
const scene = [];            // { id, name, file, yaw?, src (File|URL|canvas|null), hot: [{ d:[x,y,z], to:id }] }
const tour = { nome: '', inizio: null, cartella: null };
let correnteId = null;
let prossimoId = 1;
let modifica = false;
let ritorno = true;
let sporco = false;          // modifiche non esportate
let fade = 1;
let caricamento = 0;
const cur = { d: [0, 0, -1], on: false };
S.hover = -1;

const sceneById = (id) => scene.find((s) => s.id === id) || null;
const sceneCorrente = () => sceneById(correnteId);

function dissolvi(t) {
  return new Promise((res) => {
    const da = fade, t0 = performance.now(), dur = 160;
    const passo = () => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      fade = da + (t - da) * k;
      if (k < 1) setTimeout(passo, 16); else res();
    };
    passo();
  });
}

/* --- immagini remote (tour pubblicati): download con avanzamento e piccola cache */
const cacheBlob = new Map(); // url -> Promise<Blob>
const MAX_CACHE = QUEST ? 4 : 8;
async function scarica(url, prog) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' per ' + decodeURIComponent(url.split('/').pop()));
  const tot = +r.headers.get('content-length') || 0;
  if (!r.body || !tot || !prog) return r.blob();
  const lettore = r.body.getReader(), parti = [];
  let n = 0;
  for (;;) {
    const { done, value } = await lettore.read();
    if (done) break;
    parti.push(value); n += value.length;
    prog(Math.min(1, n / tot));
  }
  return new Blob(parti, { type: r.headers.get('content-type') || '' });
}
function blobDa(url, prog) {
  if (cacheBlob.has(url)) { const p = cacheBlob.get(url); cacheBlob.delete(url); cacheBlob.set(url, p); return p; }
  const p = scarica(url, prog);
  cacheBlob.set(url, p);
  p.catch(() => cacheBlob.delete(url));
  while (cacheBlob.size > MAX_CACHE) cacheBlob.delete(cacheBlob.keys().next().value);
  return p;
}
function preCarica(sc) { // scarica in anticipo le scene collegate
  for (const h of sc.hot) {
    const d = sceneById(h.to);
    if (d && typeof d.src === 'string' && !cacheBlob.has(d.src)) blobDa(d.src).catch(() => {});
  }
}

async function leggiSorgente(sc, prog) {
  let s = sc.src;
  if (typeof s === 'string') s = await blobDa(s, prog);
  if (s instanceof Blob) {
    return createImageBitmap(s, { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  }
  return s;
}

async function vaiAScena(id, dir) {
  const sc = sceneById(id);
  if (!sc) return;
  if (!sc.src) { stato('Immagine mancante per "' + sc.name + '": aggiungi il file ' + (sc.file || '')); return; }
  const tok = ++caricamento;
  stato('Caricamento di ' + sc.name + '…');
  try {
    if (S.pronta) await dissolvi(0);
    const src = await leggiSorgente(sc, (p) => { if (tok === caricamento) stato(`Caricamento di ${sc.name}… ${Math.round(p * 100)}%`); });
    if (tok !== caricamento) { if (src && src.close) src.close(); return; }
    caricaSorgente(src, sc.name);
    if (src && src.close) src.close();
    correnteId = id; S.hover = -1;
    // orientamento d'arrivo: nella direzione del viaggio, altrimenti la vista iniziale della scena
    let y = null;
    if (dir) y = Math.atan2(-dir[0], -dir[2]);
    else if (typeof sc.yaw === 'number') y = sc.yaw;
    if (y !== null) { S.yaw = y; S.pitch = 0; vel.x = vel.y = 0; xr.mira = -y; }
    aggiornaLista();
    aggiornaEtichette();
    aggiornaVR();
    preCarica(sc);
    await dissolvi(1);
  } catch (err) {
    console.error(err);
    fade = 1;
    stato('Impossibile aprire "' + sc.name + '": ' + (err.message || err));
  }
}

function scenaVicina(passo) {
  const ok = scene.filter((s) => s.src);
  if (!ok.length) return;
  const i = ok.findIndex((s) => s.id === correnteId);
  vaiAScena(ok[(i + passo + ok.length) % ok.length].id);
}

const IMG_RE = /\.(jpe?g|png|webp|bmp|avif)$/i;
async function aggiungiFiles(files) {
  files = [...files];
  const js = files.find((f) => /\.json$/i.test(f.name));
  if (js) {
    try { importaTour(JSON.parse(await js.text()), null); } catch (err) { stato('Tour non valido: ' + (err.message || err)); return; }
  }
  const imgs = files.filter((f) => (f.type || '').startsWith('image/') || IMG_RE.test(f.name));
  if (!imgs.length) {
    if (js) { mostraPannello(); aggiornaLista(); stato('Tour caricato: aggiungi ora le immagini (i nomi dei file devono coincidere)'); }
    return;
  }
  let primo = null;
  for (const f of imgs) {
    let sc = scene.find((s) => !s.src && s.file && s.file.toLowerCase() === f.name.toLowerCase()); // scena di un tour in attesa dell'immagine
    if (sc) sc.src = f;
    else { sc = { id: prossimoId++, name: f.name.replace(/\.[^.]+$/, ''), file: f.name, src: f, hot: [] }; scene.push(sc); sporco = true; }
    primo = primo || sc;
  }
  if (tour.inizio === null && scene.length) tour.inizio = scene[0].id;
  mostraPannello();
  aggiornaLista();
  const mancano = scene.filter((s) => !s.src).length;
  if (sceneCorrente() === null) {
    const st = sceneById(tour.inizio);
    await vaiAScena((st && st.src ? st : (scene.find((s) => s.src) || primo)).id);
  }
  if (mancano) stato(mancano + ' scene del tour senza immagine: aggiungi i file mancanti');
}

function eliminaScena(id) {
  const i = scene.findIndex((s) => s.id === id);
  if (i < 0) return;
  scene.splice(i, 1);
  scene.forEach((s) => { s.hot = s.hot.filter((h) => h.to !== id); });
  if (tour.inizio === id) tour.inizio = scene.length ? scene[0].id : null;
  sporco = true;
  if (correnteId === id) {
    correnteId = null;
    const prox = scene.find((s) => s.src);
    if (prox) vaiAScena(prox.id);
    else { S.pronta = false; $('vuoto').classList.remove('nascosto'); aggiornaStato(); aggiornaVR(); }
  }
  aggiornaLista();
  aggiornaEtichette();
}

function aggiornaLista() {
  const ul = $('scLista');
  ul.innerHTML = '';
  for (const sc of scene) {
    const li = document.createElement('li');
    if (sc.id === correnteId) li.className = 'cur';
    if (!sc.src) li.className += ' manca';
    const ini = document.createElement('button');
    ini.className = 'mini stella' + (sc.id === tour.inizio ? ' on' : '');
    ini.textContent = sc.id === tour.inizio ? '★' : '☆';
    ini.title = 'Scena iniziale del tour';
    ini.onclick = () => { tour.inizio = sc.id; sporco = true; aggiornaLista(); };
    const nome = document.createElement('button');
    nome.className = 'nome';
    nome.textContent = sc.name + (sc.src ? '' : ' (immagine mancante)') + (sc.hot.length ? '  · ' + sc.hot.length + '↗' : '');
    nome.title = sc.file || sc.name;
    nome.onclick = () => vaiAScena(sc.id);
    const ren = document.createElement('button');
    ren.className = 'mini modif'; ren.textContent = '✎'; ren.title = 'Rinomina';
    ren.onclick = () => { const n = prompt('Nome della scena', sc.name); if (n && n.trim()) { sc.name = n.trim(); sporco = true; aggiornaLista(); aggiornaEtichette(); } };
    const del = document.createElement('button');
    del.className = 'mini modif'; del.textContent = '✕'; del.title = 'Rimuovi dalla lista';
    del.onclick = () => { if (confirm('Rimuovere "' + sc.name + '" dal tour?')) eliminaScena(sc.id); };
    li.append(ini, nome, ren, del);
    ul.append(li);
  }
  $('scTitolo').textContent = tour.nome || 'Scene del tour';
}

function mostraPannello() { $('scene').hidden = false; posizionaPannello(); }
function posizionaPannello() { $('scene').style.top = ($('barra').offsetHeight + 10) + 'px'; }

/* --- geometria dei punti: raggio dal puntatore e ricerca del punto toccato */
let ult = null; // ultima matrice usata dal desktop: { inv, sbs }
function raggioDa(cx, cy) {
  if (!ult) return null;
  const r = canvas.getBoundingClientRect();
  let nx = (cx - r.left) / r.width;
  const ny = (cy - r.top) / r.height;
  if (ult.sbs) nx = (nx * 2) % 1;
  const x = nx * 2 - 1, y = 1 - ny * 2, m = ult.inv;
  const w = m[3] * x + m[7] * y + m[15];
  const v = [(m[0] * x + m[4] * y + m[12]) / w, (m[1] * x + m[5] * y + m[13]) / w, (m[2] * x + m[6] * y + m[14]) / w];
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function trovaHot(d) {
  const sc = sceneCorrente();
  if (!sc || !d) return -1;
  let best = -1, bestA = R_HOT * 1.25;
  for (let i = 0; i < Math.min(sc.hot.length, MAX_HOT); i++) {
    const h = sc.hot[i].d;
    const a = Math.acos(Math.max(-1, Math.min(1, d[0] * h[0] + d[1] * h[1] + d[2] * h[2])));
    if (a < bestA) { bestA = a; best = i; }
  }
  return best;
}

function creaCollegamento(to, d) {
  const sc = sceneCorrente();
  if (!sc) return;
  if (sc.hot.length >= MAX_HOT) { stato('Limite di ' + MAX_HOT + ' collegamenti per scena raggiunto'); return; }
  sc.hot.push({ d, to });
  if (ritorno) {
    const dst = sceneById(to);
    if (dst && !dst.hot.some((h) => h.to === sc.id) && dst.hot.length < MAX_HOT) dst.hot.push({ d: [-d[0], d[1], -d[2]], to: sc.id });
  }
  sporco = true;
  aggiornaLista();
  aggiornaEtichette();
}
function eliminaCollegamento(i) {
  const sc = sceneCorrente();
  if (!sc || i < 0) return;
  sc.hot.splice(i, 1); S.hover = -1; $('tip').hidden = true; sporco = true;
  aggiornaLista(); aggiornaEtichette();
}

function chiudiScelta() { $('scegli').hidden = true; }
function menu(cx, cy, titolo, voci) {
  const box = $('scegli');
  box.innerHTML = '';
  const t = document.createElement('div');
  t.className = 't'; t.textContent = titolo;
  box.append(t);
  for (const [testo, fn, cls] of voci) {
    const b = document.createElement('button');
    b.textContent = testo;
    if (cls) b.className = cls;
    b.onclick = () => { chiudiScelta(); if (fn) fn(); };
    box.append(b);
  }
  box.hidden = false;
  box.style.left = Math.max(8, Math.min(cx, innerWidth - box.offsetWidth - 8)) + 'px';
  box.style.top = Math.max(8, Math.min(cy, innerHeight - box.offsetHeight - 8)) + 'px';
}
function apriScelta(cx, cy, d) {
  const altre = scene.filter((s) => s.id !== correnteId);
  menu(cx, cy, altre.length ? 'Collega a:' : 'Aggiungi prima un\'altra immagine al tour',
    [...altre.map((s) => [s.name, () => creaCollegamento(s.id, d)]), ['Annulla', null, 'annulla']]);
}
function apriMenuHot(cx, cy, i) {
  const sc = sceneCorrente(), h = sc.hot[i], dest = sceneById(h.to);
  menu(cx, cy, 'Collegamento a ' + (dest ? dest.name : '?'), [
    ['Vai a ' + (dest ? dest.name : '?'), () => vaiAScena(h.to, h.d)],
    ['Elimina collegamento', () => eliminaCollegamento(i), 'pericolo'],
    ['Annulla', null, 'annulla'],
  ]);
}

function clicVista(e) {
  chiudiScelta();
  const d = raggioDa(e.clientX, e.clientY);
  if (!d || !S.pronta) return;
  const i = trovaHot(d), sc = sceneCorrente();
  if (modifica) { if (i < 0) apriScelta(e.clientX, e.clientY, d); else apriMenuHot(e.clientX, e.clientY, i); }
  else if (i >= 0) vaiAScena(sc.hot[i].to, sc.hot[i].d);
}

function aggiornaHover(e) {
  const i = S.pronta ? trovaHot(raggioDa(e.clientX, e.clientY)) : -1;
  S.hover = i;
  canvas.style.cursor = i >= 0 ? 'pointer' : (modifica ? 'crosshair' : '');
  const tip = $('tip'), sc = sceneCorrente();
  if (i >= 0 && sc) {
    const dest = sceneById(sc.hot[i].to);
    tip.textContent = (modifica ? 'Clic: opzioni · tasto destro: elimina → ' : 'Vai a: ') + (dest ? dest.name : '?');
    tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; tip.hidden = false;
  } else tip.hidden = true;
}

/* ------------------------------------------------------- salvataggio tour */
function datiTour() {
  return {
    formato: 'visualizzatore360-tour', versione: 2,
    nome: tour.nome || '', layout: S.layout, proiezione: S.proiezione, inizio: tour.inizio,
    scene: scene.map((s) => {
      const o = { id: s.id, name: s.name, file: s.file || '' };
      if (typeof s.yaw === 'number') o.yaw = +s.yaw.toFixed(4);
      o.hot = s.hot.map((h) => ({ d: h.d.map((v) => +v.toFixed(5)), to: h.to }));
      return o;
    }),
  };
}

function salvaTour() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(datiTour(), null, 1)], { type: 'application/json' }));
  a.download = 'tour.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  stato('tour.json scaricato (contiene collegamenti e nomi dei file, non le immagini)');
}

const slug = (t) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'scena';

async function esportaCartella() {
  if (!scene.length) { stato('Nessuna scena da esportare'); return; }
  if (!window.showDirectoryPicker) {
    salvaTour();
    stato('Questo browser non può scrivere cartelle (usa Chrome o Edge): scaricato solo tour.json, copia accanto le immagini');
    return;
  }
  let dir;
  try { dir = await window.showDirectoryPicker({ id: 'tour360', mode: 'readwrite' }); } catch (e) { return; }
  try {
    const usati = new Set();
    for (const [k, sc] of scene.entries()) {
      stato(`Esportazione ${k + 1}/${scene.length}: ${sc.name}…`);
      if (!sc.src) throw new Error('immagine mancante per "' + sc.name + '"');
      let blob = sc.src, nome = sc.file;
      if (typeof blob === 'string') blob = await blobDa(blob);
      else if (!(blob instanceof Blob)) { blob = await new Promise((r) => sc.src.toBlob(r, 'image/jpeg', 0.92)); nome = ''; }
      if (!nome) nome = slug(sc.name) + '.jpg';
      const base = nome;
      let n = 2;
      while (usati.has(nome.toLowerCase())) nome = base.replace(/(\.[^.]+)?$/, `-${n++}$1`);
      usati.add(nome.toLowerCase());
      sc.file = nome;
      const fh = await dir.getFileHandle(nome, { create: true });
      const w = await fh.createWritable();
      await w.write(blob); await w.close();
    }
    const fh = await dir.getFileHandle('tour.json', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(datiTour(), null, 1)); await w.close();
    sporco = false;
    stato(`Tour esportato nella cartella "${dir.name}". Se è dentro "tours" del progetto, esegui pubblica.bat per metterlo online.`);
  } catch (err) {
    console.error(err);
    stato('Esportazione non riuscita: ' + (err.message || err));
  }
}

function importaTour(dati, risolvi) {
  if (!dati || dati.formato !== 'visualizzatore360-tour' || !Array.isArray(dati.scene)) throw new Error('file non valido');
  caricamento++;
  scene.length = 0; correnteId = null; S.pronta = false; labFirma = null;
  for (const s of dati.scene) {
    scene.push({
      id: +s.id, name: String(s.name || s.file || 'Scena'), file: String(s.file || ''),
      yaw: typeof s.yaw === 'number' ? s.yaw : undefined,
      src: risolvi && s.file ? risolvi(String(s.file)) : null,
      hot: (s.hot || []).filter((h) => Array.isArray(h.d) && h.d.length === 3).map((h) => ({ d: h.d.map(Number), to: +h.to })),
    });
  }
  prossimoId = Math.max(0, ...scene.map((s) => s.id)) + 1;
  tour.nome = String(dati.nome || '');
  tour.inizio = scene.some((s) => s.id === +dati.inizio) ? +dati.inizio : (scene.length ? scene[0].id : null);
  if (['auto', 'tb', 'sbs', 'mono'].includes(dati.layout)) { S.layout = dati.layout; el.layout.value = S.layout; }
  if (['360', '180'].includes(dati.proiezione)) { S.proiezione = dati.proiezione; el.proiezione.value = S.proiezione; }
  $('tourNome').value = tour.nome;
  sporco = false;
  $('vuoto').classList.remove('nascosto');
  aggiornaVR();
}

/* --------------------------------------------- tour pubblicati nel repository */
async function caricaIndice() {
  const box = $('tourLista');
  try {
    const r = await fetch('tours/index.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const lista = Array.isArray(j.tour) ? j.tour : [];
    box.innerHTML = '';
    for (const t of lista) {
      const b = document.createElement('button');
      b.className = 'tour-card';
      const n = document.createElement('b'); n.textContent = t.nome || t.cartella;
      const s = document.createElement('span'); s.textContent = (t.scene || '?') + ' scene';
      b.append(n, s);
      b.onclick = () => apriTourRemoto(t.cartella);
      box.append(b);
    }
    $('tourSez').hidden = !lista.length;
  } catch (e) {
    $('tourSez').hidden = true; // aperto da file:// o senza cartella tours
  }
}

async function apriTourRemoto(cartella) {
  stato('Apertura del tour ' + cartella + '…');
  try {
    const base = new URL('tours/' + encodeURIComponent(cartella) + '/', document.baseURI);
    const r = await fetch(new URL('tour.json', base), { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    importaTour(await r.json(), (f) => new URL(f.split('/').map(encodeURIComponent).join('/'), base).href);
    tour.cartella = cartella;
    try { history.replaceState(null, '', '?tour=' + encodeURIComponent(cartella)); } catch (e) { /* ignora */ }
    if (!QUEST || innerWidth > 900) mostraPannello();
    aggiornaLista();
    const st = sceneById(tour.inizio) || scene[0];
    if (st) await vaiAScena(st.id);
  } catch (err) {
    console.error(err);
    stato('Impossibile aprire il tour "' + cartella + '": ' + (err.message || err));
  }
}

function tornaHome() {
  if (sporco && scene.length && !confirm('Ci sono modifiche al tour non esportate. Tornare all\'elenco?')) return;
  caricamento++;
  scene.length = 0; correnteId = null; S.pronta = false; labFirma = null;
  tour.nome = ''; tour.inizio = null; tour.cartella = null; sporco = false;
  $('tourNome').value = '';
  impostaModifica(false);
  $('scene').hidden = true;
  $('vuoto').classList.remove('nascosto');
  aggiornaLista(); aggiornaStato(); aggiornaVR();
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignora */ }
  caricaIndice();
}

function stato(t) { $('stato').textContent = t; }
function aggiornaStato() {
  if (!S.pronta) return stato('Nessuna immagine caricata');
  const auto = S.layout === 'auto' ? ' (auto)' : '';
  stato(`${S.nome} · ${S.w}×${S.h} · ${NOMI_LAYOUT[layoutEffettivo()]}${auto} · ${S.proiezione}°${S.nota || ''}`);
}

/* ------------------------------------------------------------- rendering */
function disegnaOcchio(occhio, invPV) {
  const r = regione(occhio);
  gl.uniformMatrix4fv(U.uInvPV, false, invPV);
  gl.uniform4f(U.uRegion, r[0], r[1], r[2], r[3]);
  gl.uniform2f(U.uTexel, 0.5 / S.w, 0.5 / S.h);
  gl.uniform1f(U.uSpan, S.proiezione === '180' ? Math.PI : Math.PI * 2);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

const hotBuf = new Float32Array(MAX_HOT * 4);
function preparaPassata() {
  gl.useProgram(prog);
  gl.bindVertexArray(vao);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, labTex);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(U.uTex, 0);
  gl.uniform1i(U.uLab, 1);
  const sc = sceneCorrente(), n = sc ? Math.min(sc.hot.length, MAX_HOT) : 0;
  for (let i = 0; i < n; i++) { hotBuf.set(sc.hot[i].d, i * 4); hotBuf[i * 4 + 3] = i === S.hover ? 1 : 0; }
  gl.uniform4fv(U.uHot, hotBuf);
  gl.uniform1i(U.uNHot, n);
  gl.uniform4f(U.uCur, cur.d[0], cur.d[1], cur.d[2], cur.on ? 1 : 0);
  gl.uniform1f(U.uEdit, modifica ? 1 : 0);
  gl.uniform1f(U.uFade, fade);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
}

function matriceInversa(proiezione, vista) { return invert(mul(proiezione, vista)); }

function disegnaDesktop() {
  const w = canvas.width, h = canvas.height;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.colorMask(true, true, true, true);
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!S.pronta) return;
  preparaPassata();

  const fov = S.fov * Math.PI / 180;
  const vista = mul(rotX(-S.pitch), rotY(-S.yaw));

  if (S.vista === 'sbs') {
    const mw = Math.floor(w / 2);
    const inv = matriceInversa(perspective(fov, mw / h, 0.1, 100), vista);
    ult = { inv, sbs: true };
    gl.viewport(0, 0, mw, h); disegnaOcchio(0, inv);
    gl.viewport(mw, 0, w - mw, h); disegnaOcchio(1, inv);
    return;
  }
  const inv = matriceInversa(perspective(fov, w / h, 0.1, 100), vista);
  ult = { inv, sbs: false };
  if (S.vista === 'anaglifo') {
    gl.colorMask(true, false, false, true); disegnaOcchio(0, inv);
    gl.colorMask(false, true, true, true); disegnaOcchio(1, inv);
    gl.colorMask(true, true, true, true);
  } else {
    disegnaOcchio(0, inv);
  }
}

let ultimo = 0;
function ciclo(t) {
  requestAnimationFrame(ciclo);
  const dt = Math.min(0.1, (t - ultimo) / 1000); ultimo = t;
  if (xr.sessione) return;
  // inerzia (rad/s) + rotazione automatica
  if (!trascinando) {
    S.yaw += vel.x * dt; S.pitch += vel.y * dt;
    const f = Math.exp(-dt * 4);
    vel.x *= f; vel.y *= f;
    if (Math.abs(vel.x) < 1e-3) vel.x = 0;
    if (Math.abs(vel.y) < 1e-3) vel.y = 0;
    if (S.auto) S.yaw += 0.12 * dt;
  }
  S.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, S.pitch));
  adattaCanvas();
  disegnaDesktop();
}

function adattaCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}

/* ----------------------------------------------------------- interazione */
let trascinando = false;
const vel = { x: 0, y: 0 };
const puntatori = new Map();
let distPizzico = 0;

function kFov() { return (S.fov * Math.PI / 180) / Math.max(1, canvas.clientHeight); }

let inizio = null; // per distinguere clic e trascinamento
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  puntatori.set(e.pointerId, { x: e.clientX, y: e.clientY });
  inizio = (puntatori.size === 1 && e.button === 0) ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
  trascinando = true; vel.x = vel.y = 0;
  canvas.classList.add('trascina');
  if (puntatori.size === 2) distPizzico = distanzaPuntatori();
});
canvas.addEventListener('pointermove', (e) => {
  const p = puntatori.get(e.pointerId);
  if (!p) { if (e.pointerType === 'mouse') aggiornaHover(e); return; }
  if (puntatori.size >= 2) inizio = null;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (puntatori.size === 2) {
    const d = distanzaPuntatori();
    if (distPizzico) impostaFov(S.fov * distPizzico / d);
    distPizzico = d;
    return;
  }
  const k = kFov();
  S.yaw += dx * k; S.pitch += dy * k;
  const ora = performance.now(), dtMs = Math.max(8, ora - ultimoMove);
  ultimoMove = ora;
  const lim = (v) => Math.max(-4, Math.min(4, v));
  vel.x = vel.x * 0.5 + lim(dx * k / dtMs * 1000) * 0.5;
  vel.y = vel.y * 0.5 + lim(dy * k / dtMs * 1000) * 0.5;
});
let ultimoMove = 0;
function finePuntatore(e) {
  if (performance.now() - ultimoMove > 80) vel.x = vel.y = 0; // fermo prima del rilascio: niente inerzia
  puntatori.delete(e.pointerId);
  if (puntatori.size < 2) distPizzico = 0;
  if (puntatori.size === 0) { trascinando = false; canvas.classList.remove('trascina'); }
}
canvas.addEventListener('pointerup', (e) => {
  if (inizio && e.button === 0 && Math.hypot(e.clientX - inizio.x, e.clientY - inizio.y) < 8 && performance.now() - inizio.t < 700) clicVista(e);
  inizio = null;
  finePuntatore(e);
});
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!modifica) return;
  eliminaCollegamento(trovaHot(raggioDa(e.clientX, e.clientY)));
});
canvas.addEventListener('pointercancel', finePuntatore);
function distanzaPuntatori() {
  const [a, b] = [...puntatori.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  impostaFov(S.fov * Math.exp(e.deltaY * 0.001));
}, { passive: false });

function impostaFov(v) {
  S.fov = Math.max(25, Math.min(120, v));
  $('fov').value = S.fov; salva();
}

/* -------------------------------------------------------------------- UI */
const el = { layout: $('layout'), proiezione: $('proiezione'), vista: $('vista'), scambia: $('scambia'), auto: $('auto'), fov: $('fov') };
el.layout.value = S.layout; el.proiezione.value = S.proiezione; el.vista.value = S.vista;
el.scambia.checked = S.scambia; el.fov.value = S.fov;

el.layout.onchange = () => { S.layout = el.layout.value; salva(); aggiornaStato(); sporco = true; };
el.proiezione.onchange = () => { S.proiezione = el.proiezione.value; salva(); aggiornaStato(); sporco = true; };
el.vista.onchange = () => { S.vista = el.vista.value; salva(); };
el.scambia.onchange = () => { S.scambia = el.scambia.checked; salva(); };
el.auto.onchange = () => { S.auto = el.auto.checked; };
el.fov.oninput = () => { S.fov = +el.fov.value; salva(); };

const inputFile = $('file');
const apriDialogo = () => inputFile.click();
$('btnApri').onclick = apriDialogo;
$('vuotoApri').onclick = apriDialogo;
inputFile.onchange = () => { const f = [...inputFile.files]; inputFile.value = ''; aggiungiFiles(f); };
$('scAggiungi').onclick = apriDialogo;
$('btnScene').onclick = () => { const p = $('scene'); p.hidden = !p.hidden; posizionaPannello(); };
$('btnHome').onclick = tornaHome;
$('modifica').onchange = () => impostaModifica($('modifica').checked);
$('ritorno').onchange = () => { ritorno = $('ritorno').checked; };
$('scSalva').onclick = salvaTour;
$('scEsporta').onclick = esportaCartella;
$('scVista').onclick = () => {
  const sc = sceneCorrente();
  if (!sc) return;
  sc.yaw = S.yaw; sporco = true;
  stato('Vista iniziale di "' + sc.name + '" impostata');
};
$('tourNome').oninput = () => { tour.nome = $('tourNome').value.trim(); sporco = true; $('scTitolo').textContent = tour.nome || 'Scene del tour'; };
$('fileTour').onchange = () => { const f = [...$('fileTour').files]; $('fileTour').value = ''; if (f.length) aggiungiFiles(f); };
$('scCarica').onclick = () => $('fileTour').click();
$('vuotoTour').onclick = () => $('fileTour').click();
function impostaModifica(v) {
  modifica = v; $('modifica').checked = v; chiudiScelta();
  document.body.classList.toggle('modifica', v);
  canvas.style.cursor = v ? 'crosshair' : '';
  if (v && $('scene').hidden) mostraPannello();
}
window.addEventListener('resize', posizionaPannello);
$('btnCentra').onclick = centra;
$('btnProva').onclick = caricaProva;
$('vuotoProva').onclick = caricaProva;
$('btnFull').onclick = schermoIntero;

function centra() { S.yaw = 0; S.pitch = 0; vel.x = vel.y = 0; }
function schermoIntero() {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
}
function cambiaVista() {
  const ordine = ['mono', 'anaglifo', 'sbs'];
  S.vista = ordine[(ordine.indexOf(S.vista) + 1) % ordine.length];
  el.vista.value = S.vista; salva();
}

// trascinamento file
let contaDrag = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); contaDrag++; document.body.classList.add('trascinando'); });
window.addEventListener('dragleave', () => { if (--contaDrag <= 0) { contaDrag = 0; document.body.classList.remove('trascinando'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); contaDrag = 0; document.body.classList.remove('trascinando');
  aggiungiFiles([...(e.dataTransfer.files || [])]);
});

// scorciatoie
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target && e.target.tagName;
  if (t === 'SELECT' || t === 'TEXTAREA' || (t === 'INPUT' && e.target.type !== 'checkbox')) return;
  const passo = 0.05 * (S.fov / 75);
  switch (e.key) {
    case 'ArrowLeft': S.yaw -= passo; break;
    case 'ArrowRight': S.yaw += passo; break;
    case 'ArrowUp': S.pitch -= passo; break;
    case 'ArrowDown': S.pitch += passo; break;
    case '+': case '=': impostaFov(S.fov * 0.92); break;
    case '-': case '_': impostaFov(S.fov / 0.92); break;
    case 'c': case 'C': centra(); break;
    case 'f': case 'F': schermoIntero(); break;
    case 's': case 'S': S.scambia = !S.scambia; el.scambia.checked = S.scambia; salva(); break;
    case 'v': case 'V': cambiaVista(); break;
    case 'o': case 'O': apriDialogo(); break;
    case 'h': case 'H': document.body.classList.toggle('nascondi'); break;
    case 'e': case 'E': impostaModifica(!modifica); break;
    case 'p': case 'P': $('btnScene').click(); break;
    case 'PageDown': case 'n': case 'N': scenaVicina(1); break;
    case 'PageUp': case 'b': case 'B': scenaVicina(-1); break;
    case 'Escape': chiudiScelta(); break;
    case '?': $('aiuto').hidden = !$('aiuto').hidden; break;
    default: return;
  }
  e.preventDefault();
});

// nasconde la barra dopo un po' di inattività (solo a schermo intero)
let timerIdle = 0;
function svegliaUI() {
  document.body.classList.remove('nascondi');
  clearTimeout(timerIdle);
  if (document.fullscreenElement) timerIdle = setTimeout(() => document.body.classList.add('nascondi'), 3500);
}
window.addEventListener('pointermove', svegliaUI);
document.addEventListener('fullscreenchange', svegliaUI);

/* ------------------------------------------------------------------- WebXR */
// xr.yaw ruota il panorama attorno alla verticale (rotazione a scatti, arrivo nella direzione del viaggio);
// xr.mira = longitudine del panorama da mettere davanti allo sguardo al prossimo frame.
const xr = { sessione: null, spazio: null, ok: false, yaw: 0, mira: null };
const btnVR = $('btnVR'), vrGrande = $('vrGrande');

function aggiornaVR() {
  vrGrande.hidden = !(xr.ok && S.pronta && !xr.sessione);
}

if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    xr.ok = ok;
    if (ok) btnVR.disabled = false;
    else btnVR.title = 'VR non disponibile: nessun visore rilevato';
    aggiornaVR();
  }).catch(() => {});
} else {
  btnVR.title = 'WebXR non supportato (serve https o http://localhost)';
}

async function entraVR() {
  if (xr.sessione) { xr.sessione.end(); return; }
  try {
    const s = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'hand-tracking'] });
    await gl.makeXRCompatible();
    let scala = 1;
    try { scala = Math.min(1.3, Math.max(1, XRWebGLLayer.getNativeFramebufferScaleFactor(s))); } catch (e) { /* default */ }
    s.updateRenderState({ baseLayer: new XRWebGLLayer(s, gl, { depth: false, antialias: false, framebufferScaleFactor: scala }) });
    xr.spazio = await s.requestReferenceSpace('local');
    xr.sessione = s; xr.yaw = 0; xr.mira = -S.yaw; // davanti c'è quello che si guardava sul desktop
    btnVR.textContent = 'Esci da VR';
    chiudiScelta();
    aggiornaVR();
    s.addEventListener('select', (ev) => { // grilletto / pizzico: teletrasporto
      const i = trovaHot(raggioXR(ev.frame, ev.inputSource));
      const sc = sceneCorrente();
      if (i >= 0 && sc) vaiAScena(sc.hot[i].to, sc.hot[i].d);
    });
    s.addEventListener('end', () => {
      xr.sessione = null; xr.spazio = null; btnVR.textContent = 'Entra in VR';
      cur.on = false; S.hover = -1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      aggiornaVR();
    });
    s.requestAnimationFrame(frameXR);
  } catch (err) {
    console.error(err);
    stato('Avvio VR non riuscito: ' + (err.message || err));
  }
}
btnVR.onclick = entraVR;
vrGrande.onclick = entraVR;

function raggioXR(frame, src) { // direzione del raggio del controller, nelle coordinate del panorama
  if (!frame || !src || !src.targetRaySpace) return null;
  const p = frame.getPose(src.targetRaySpace, xr.spazio);
  if (!p) return null;
  const m = p.transform.matrix;
  const l = Math.hypot(m[8], m[9], m[10]) || 1;
  return ruotaY(-xr.yaw, [-m[8] / l, -m[9] / l, -m[10] / l]);
}

const statoPad = new WeakMap();
function comandiXR(s) {
  for (const src of s.inputSources) {
    const gp = src.gamepad;
    if (!gp) continue;
    let st = statoPad.get(src);
    if (!st) { st = { giro: false, b: [] }; statoPad.set(src, st); }
    // levetta destra/sinistra: rotazione a scatti di 30°
    const x = gp.axes.length >= 4 ? gp.axes[2] : 0;
    if (!st.giro && Math.abs(x) > 0.7) { st.giro = true; xr.yaw += Math.sign(x) * Math.PI / 6; }
    else if (Math.abs(x) < 0.3) st.giro = false;
    // A / X: scena successiva · B / Y: scena precedente
    for (const k of [4, 5]) {
      const p = !!(gp.buttons[k] && gp.buttons[k].pressed);
      if (p && !st.b[k]) scenaVicina(k === 4 ? 1 : -1);
      st.b[k] = p;
    }
  }
}

function frameXR(t, frame) {
  const s = frame.session;
  s.requestAnimationFrame(frameXR);
  const pose = frame.getViewerPose(xr.spazio);
  if (!pose) return;
  const hm = pose.transform.matrix;
  if (xr.mira !== null) { xr.yaw = xr.mira - Math.atan2(-hm[8], hm[10]); xr.mira = null; }
  comandiXR(s);
  // puntatore del controller: evidenzia i collegamenti (preferisce la mano destra)
  cur.on = false;
  const fonti = [...s.inputSources].sort((a, b) => (b.handedness === 'right') - (a.handedness === 'right'));
  for (const src of fonti) {
    const d = raggioXR(frame, src);
    if (d) { cur.d = d; cur.on = true; break; }
  }
  S.hover = cur.on ? trovaHot(cur.d) : -1;
  const layer = s.renderState.baseLayer;
  gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
  gl.colorMask(true, true, true, true);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!S.pronta) return;
  preparaPassata();
  const giro = rotY(xr.yaw);
  for (const v of pose.views) {
    const vp = layer.getViewport(v);
    gl.viewport(vp.x, vp.y, vp.width, vp.height);
    const vista = new Float32Array(v.transform.inverse.matrix);
    vista[12] = vista[13] = vista[14] = 0; // il panorama è all'infinito: solo rotazione
    disegnaOcchio(v.eye === 'right' ? 1 : 0, matriceInversa(v.projectionMatrix, mul(vista, giro)));
  }
}

/* -------------------------------------------------- immagine stereo di prova */
const dirLonLat = (lon, lat) => {
  const a = lon * Math.PI / 180, b = lat * Math.PI / 180;
  return [Math.cos(b) * Math.sin(a), Math.sin(b), -Math.cos(b) * Math.cos(a)];
};

function caricaProva() {
  stato('Generazione scene di prova…');
  setTimeout(async () => {
    const A = { id: prossimoId++, name: 'Prova A', file: '', hot: [], src: creaProva(['#0d1b3d', '#6aa6d8', '#4a5a48', '#1b221a'], 'SCENA A') };
    const B = { id: prossimoId++, name: 'Prova B', file: '', hot: [], src: creaProva(['#3d1b0d', '#d89a6a', '#5a4a48', '#221a1b'], 'SCENA B') };
    A.hot.push({ d: dirLonLat(45, -8), to: B.id });
    B.hot.push({ d: dirLonLat(-135, -8), to: A.id });
    scene.push(A, B);
    if (tour.inizio === null) tour.inizio = A.id;
    mostraPannello(); aggiornaLista();
    await vaiAScena(A.id);
    centra();
  }, 30);
}

function creaProva(pal, titolo) {
    const W = 4096, H = 2048;
    const c = document.createElement('canvas');
    c.width = W; c.height = H * 2;
    const x = c.getContext('2d');
    const oggetti = [ // lon (°), lat (°), raggio (°), disparità (px, + = più vicino), colore, etichetta
      [0, 5, 7, 36, '#ff5a4d', 'VICINO'], [60, 0, 6, 18, '#ffc233', 'MEDIO'], [-70, 8, 6, 8, '#4dd2ff', 'LONTANO'],
      [120, -5, 8, 30, '#7be36b', 'VICINO'], [-130, 10, 7, 14, '#c58bff', 'MEDIO'], [180, 0, 9, 22, '#ff8fd0', 'DIETRO'],
      [0, 55, 8, 40, '#ffffff', 'ZENIT'], [30, -45, 8, 28, '#ffe08a', 'SUOLO'],
    ];
    for (let occhio = 0; occhio < 2; occhio++) {
      const oy = occhio * H, sg = occhio === 0 ? 1 : -1; // occhio sinistro: oggetti vicini spostati a destra
      x.save();
      x.beginPath(); x.rect(0, oy, W, H); x.clip();
      const g = x.createLinearGradient(0, oy, 0, oy + H);
      g.addColorStop(0, pal[0]); g.addColorStop(0.5, pal[1]); g.addColorStop(0.5, pal[2]); g.addColorStop(1, pal[3]);
      x.fillStyle = g; x.fillRect(0, oy, W, H);
      // griglia (all'infinito: nessuna disparità)
      x.lineWidth = 2;
      for (let lon = -180; lon < 180; lon += 15) {
        const px = (lon + 180) / 360 * W;
        x.strokeStyle = lon % 90 === 0 ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.22)';
        x.beginPath(); x.moveTo(px, oy); x.lineTo(px, oy + H); x.stroke();
      }
      for (let lat = -75; lat <= 75; lat += 15) {
        const py = oy + (90 - lat) / 180 * H;
        x.strokeStyle = lat === 0 ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.22)';
        x.beginPath(); x.moveTo(0, py); x.lineTo(W, py); x.stroke();
      }
      x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = 'bold 40px system-ui';
      [['N', 0], ['E', 90], ['S', 180], ['O', -90]].forEach(([t, lon]) => {
        x.fillText(t, (lon + 180) / 360 * W, oy + H * 0.5 - 70);
      });
      x.font = 'bold 120px system-ui'; x.fillStyle = 'rgba(255,255,255,.9)';
      x.fillText(titolo, W / 2, oy + H * 0.5 - 330);
      x.fillStyle = '#fff'; x.font = '26px system-ui';
      for (let lon = -150; lon <= 180; lon += 30) x.fillText(lon + '°', (lon + 180) / 360 * W, oy + H * 0.5 + 24);
      // oggetti con parallasse
      for (const [lon, lat, r, d, col, et] of oggetti) {
        const cx = (lon + 180) / 360 * W + sg * d / 2, cy = oy + (90 - lat) / 180 * H;
        const rx = r / 360 * W, ry = r / 180 * H;
        for (const off of [-W, 0, W]) { // ripetizione orizzontale: gli oggetti attraversano la cucitura
          x.fillStyle = col; x.strokeStyle = '#000'; x.lineWidth = 4;
          x.beginPath(); x.ellipse(cx + off, cy, rx, ry, 0, 0, Math.PI * 2); x.fill(); x.stroke();
          x.fillStyle = '#000'; x.font = 'bold 30px system-ui'; x.fillText(et, cx + off, cy);
        }
      }
      x.restore();
    }
    return c;
}

/* ------------------------------------------------------------------ avvio */
adattaCanvas();
requestAnimationFrame(ciclo);
caricaIndice();
const tourParam = new URLSearchParams(location.search).get('tour');
if (tourParam) apriTourRemoto(tourParam);

// debug per i test automatici
window.__v360 = { S, scene, tour, xr, caricaProva, aggiungiFiles, vaiAScena, caricaSorgente, creaCollegamento, apriTourRemoto, datiTour, importaTour };
})();
