const API = '/api2';
// const API = 'http://localhost:3001';

let image         = null;   // File | null
let preview       = null;   // object URL | null
let rawData       = null;   // raw OCR response object | null
let fullRawJson   = '';
let processedJson = '';
let jsonLoadingTab = null;  // 'full' | 'processed' | null
let stage         = 'idle'; // idle | ocr-loading | ocr-done | exec-done
let ocrTab        = 'text'; // text | processed | full
let camMode       = false;
let camRotation   = 90;
let stream        = null;

// ─────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────
const btnCam          = document.getElementById('btn-cam');
const btnUpload       = document.getElementById('btn-upload');
const btnOcr          = document.getElementById('btn-ocr');
const btnRunSketch    = document.getElementById('btn-run-sketch');
const btnRotate       = document.getElementById('btn-rotate');
const btnShot         = document.getElementById('btn-shot');
const btnCopyOcr      = document.getElementById('btn-copy-ocr');
const tabText         = document.getElementById('tab-text');
const tabProcessed    = document.getElementById('tab-processed');
const tabFull         = document.getElementById('tab-full');
const dropzone        = document.getElementById('dropzone');
const fileInput       = document.getElementById('file-input');
const camWrapper      = document.getElementById('cam-wrapper');
const camVideo        = document.getElementById('cam-video');
const camCanvas       = document.getElementById('cam-canvas');
const ocrError        = document.getElementById('ocr-error');
const ocrTextarea     = document.getElementById('ocr-textarea');
const ocrProcessed    = document.getElementById('ocr-processed-pane');
const ocrFull         = document.getElementById('ocr-full-pane');
const fullJsonMeta    = document.getElementById('full-json-meta');
const fullJsonPre     = document.getElementById('full-json-pre');
const codeEditor      = document.getElementById('code-editor');
const sketchFrame     = document.getElementById('sketch-frame');
const sketchConsole   = document.getElementById('sketch-console');
const ocrProgress     = document.getElementById('ocr-progress');
const serverStatusImg = document.getElementById('server-status-img');
const serverStatusTxt = document.getElementById('server-status-text');

// ─────────────────────────────────────────────
// Server status
// ─────────────────────────────────────────────
async function checkServerStatus() {
  try {
    const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      serverStatusImg.src      = '../public/shiba_awake.png';
      serverStatusTxt.textContent  = 'Server Awake';
      serverStatusTxt.style.color  = 'var(--success, rgb(0, 194, 71))';
    } else {
      throw new Error('not ok');
    }
  } catch {
    serverStatusImg.src      = '../public/shiba_sleep.png';
    serverStatusTxt.textContent  = 'Server Asleep';
    serverStatusTxt.style.color  = 'var(--error, #e55)';
  }
}

// ─────────────────────────────────────────────
// OCR data helpers
// ─────────────────────────────────────────────
function anchorText(anchor, fullText) {
  if (!anchor || typeof anchor !== 'object') return '';
  const content = anchor.content;
  if (typeof content === 'string' && content.length > 0) return content;
  const segs = anchor.textSegments;
  if (!Array.isArray(segs)) return '';
  return segs.map(seg => {
    if (!seg || typeof seg !== 'object') return '';
    const start = Number(seg.startIndex ?? 0);
    const end   = Number(seg.endIndex   ?? 0);
    if (!isFinite(start) || !isFinite(end) || end <= start) return '';
    return fullText.slice(start, end);
  }).join('');
}

function toNumber(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') { const p = Number(v); if (isFinite(p)) return p; }
  return null;
}

function readPageSize(page) {
  if (!page || typeof page !== 'object') return { width: null, height: null };
  const dim = page.dimension;
  if (!dim || typeof dim !== 'object') return { width: null, height: null };
  return { width: toNumber(dim.width), height: toNumber(dim.height) };
}

function layoutRect(layout, pw, ph) {
  if (!layout || typeof layout !== 'object') return { x: null, y: null, w: null, h: null };
  const bp = layout.boundingPoly;
  if (!bp || typeof bp !== 'object') return { x: null, y: null, w: null, h: null };
  let xs = [], ys = [];
  if (Array.isArray(bp.vertices) && bp.vertices.length) {
    xs = bp.vertices.map(v => (v && typeof v.x === 'number' ? v.x : null)).filter(v => v !== null);
    ys = bp.vertices.map(v => (v && typeof v.y === 'number' ? v.y : null)).filter(v => v !== null);
  }
  if (!xs.length || !ys.length) {
    if (Array.isArray(bp.normalizedVertices) && bp.normalizedVertices.length) {
      const nxs = bp.normalizedVertices.map(v => toNumber(v && v.x)).filter(v => v !== null);
      const nys = bp.normalizedVertices.map(v => toNumber(v && v.y)).filter(v => v !== null);
      if (nxs.length && pw !== null) xs = nxs.map(v => v * pw);
      if (nys.length && ph !== null) ys = nys.map(v => v * ph);
    }
  }
  if (!xs.length || !ys.length) return { x: null, y: null, w: null, h: null };
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
}

function extractProcessedEntries(raw) {
  const empty = { format: '[text, x, y, w, h]', imageSize: { width: null, height: null }, entries: [] };
  if (!raw || typeof raw !== 'object') return empty;
  const fullText = typeof raw.text === 'string' ? raw.text : '';
  const pages = Array.isArray(raw.pages) ? raw.pages : [];
  const entries = [];
  const firstPageSize = pages.length ? readPageSize(pages[0]) : { width: null, height: null };
  for (const page of pages) {
    if (!page || typeof page !== 'object') continue;
    const { width: pw, height: ph } = readPageSize(page);
    const tokens = Array.isArray(page.tokens) ? page.tokens : [];
    for (const token of tokens) {
      if (!token || typeof token !== 'object') continue;
      const layout  = token.layout;
      const content = anchorText(layout && layout.textAnchor, fullText);
      const text    = content.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const { x, y, w, h } = layoutRect(layout, pw, ph);
      entries.push([text, x, y, w, h]);
    }
    if (tokens.length) continue;
    const symbols = Array.isArray(page.symbols) ? page.symbols : [];
    for (const sym of symbols) {
      if (!sym || typeof sym !== 'object') continue;
      const layout  = sym.layout;
      const content = anchorText(layout && layout.textAnchor, fullText);
      const text    = content.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const { x, y, w, h } = layoutRect(layout, pw, ph);
      entries.push([text, x, y, w, h]);
    }
  }
  if (entries.length) return { format: '[text, x, y, w, h]', imageSize: firstPageSize, entries };
  if (!fullText)      return { ...empty, imageSize: firstPageSize };
  return {
    format: '[text, x, y, w, h]',
    imageSize: firstPageSize,
    entries: Array.from(fullText).filter(c => /\S/.test(c)).map(c => [c, null, null, null, null]),
  };
}

// ─────────────────────────────────────────────
// Sketch helpers
// ─────────────────────────────────────────────
function buildSketchHtml(userCode) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { margin:0; }
    canvas { display:block; }
  </style>
</head>
<body>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.11.2/p5.min.js"><\/script>
  <script>
    function relay(level, args) {
      try { parent.postMessage({ source:'p5-sketch', level, message: Array.from(args).join(' ') }, '*'); } catch(e) {}
    }
    const _e=console.error.bind(console), _w=console.warn.bind(console), _l=console.log.bind(console);
    console.error = function(){ relay('error',arguments); _e.apply(console,arguments); };
    console.warn  = function(){ relay('warn', arguments); _w.apply(console,arguments); };
    console.log   = function(){ relay('log',  arguments); _l.apply(console,arguments); };
    window.onerror = function(msg,src,line){
      relay('error',[msg+(line?' (line '+line+')':'')]); return true;
    };
    window.addEventListener('unhandledrejection', function(e){
      relay('error',[e.reason ? String(e.reason) : 'Unhandled promise rejection']);
    });
  <\/script>
  <script>
${userCode}
  <\/script>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// Progress
// ─────────────────────────────────────────────
function setProgress(msg, isError = false) {
  if (!ocrProgress) return;
  ocrProgress.textContent = msg;
  ocrProgress.style.color = isError ? 'var(--error, #e55)' : 'var(--fg-muted, #888)';
  ocrProgress.style.display = msg ? '' : 'none';
}

// ─────────────────────────────────────────────
// UI state
// ─────────────────────────────────────────────
function setStage(s) {
  stage = s;
  btnOcr.disabled       = !image || stage === 'ocr-loading';
  btnOcr.textContent    = stage === 'ocr-loading' ? 'Extracting…' : 'Send Request';
  btnRunSketch.disabled = !codeEditor.value.trim();
  codeEditor.disabled   = stage === 'idle' || stage === 'ocr-loading';
}

function showOcrPane(tab) {
  ocrTab = tab;
  ocrTextarea.style.display  = 'none';
  ocrProcessed.style.display = 'none';
  ocrFull.style.display      = 'none';
  tabText.classList.remove('active');
  tabProcessed.classList.remove('active');
  tabFull.classList.remove('active');

  if (tab === 'text') {
    tabText.classList.add('active');
    ocrTextarea.style.display = 'block';

  } else if (tab === 'processed') {
    tabProcessed.classList.add('active');
    ocrProcessed.style.display = 'block';
    if (!processedJson && rawData && !jsonLoadingTab) {
      jsonLoadingTab = 'processed';
      tabProcessed.textContent = 'Processed JSON..';
      setTimeout(() => {
        processedJson = JSON.stringify(extractProcessedEntries(rawData), null, 2);
        ocrProcessed.textContent = processedJson;
        tabProcessed.textContent = 'Processed JSON';
        jsonLoadingTab = null;
        updateCopyBtn();
      }, 0);
    } else {
      ocrProcessed.textContent = processedJson;
    }

  } else if (tab === 'full') {
    tabFull.classList.add('active');
    ocrFull.style.display = 'block';
    if (!fullRawJson && rawData && !jsonLoadingTab) {
      jsonLoadingTab = 'full';
      tabFull.textContent = 'Full Raw JSON..';
      setTimeout(() => {
        fullRawJson = JSON.stringify(rawData, null, 2);
        fullJsonMeta.textContent = 'Length: ' + fullRawJson.length;
        fullJsonPre.textContent  = fullRawJson.split('\n').slice(0, 10).join('\n');
        tabFull.textContent = 'Full Raw JSON';
        jsonLoadingTab = null;
        updateCopyBtn();
      }, 0);
    } else {
      fullJsonMeta.textContent = 'Length: ' + fullRawJson.length;
      fullJsonPre.textContent  = fullRawJson.split('\n').slice(0, 10).join('\n');
    }
  }

  updateCopyBtn();
}

function updateCopyBtn() {
  if (ocrTab === 'text')      btnCopyOcr.disabled = !ocrTextarea.value;
  else if (ocrTab === 'full') btnCopyOcr.disabled = !fullRawJson || jsonLoadingTab === 'full';
  else                        btnCopyOcr.disabled = !processedJson || jsonLoadingTab === 'processed';
}

function showError(msg) {
  ocrError.textContent   = msg;
  ocrError.style.display = msg ? '' : 'none';
}

function addConsoleLog(level, message) {
  sketchConsole.style.display = '';
  const div = document.createElement('div');
  div.className   = `console-line console-${level}`;
  div.textContent = message;
  sketchConsole.appendChild(div);
  sketchConsole.scrollTop = sketchConsole.scrollHeight;
}

// ─────────────────────────────────────────────
// File handling
// ─────────────────────────────────────────────
function acceptFile(file) {
  if (preview) URL.revokeObjectURL(preview);
  image   = file;
  preview = URL.createObjectURL(file);

  rawData        = null;
  fullRawJson    = '';
  processedJson  = '';
  jsonLoadingTab = null;

  ocrTextarea.value        = '';
  ocrProcessed.textContent = '';
  fullJsonPre.textContent  = '';
  codeEditor.value         = '';
  sketchFrame.srcdoc       = '';
  sketchConsole.innerHTML  = '';
  sketchConsole.style.display = 'none';
  showError('');
  setProgress('');

  dropzone.innerHTML = '';
  const img = document.createElement('img');
  img.src       = preview;
  img.alt       = 'Uploaded image';
  img.className = 'preview-img';
  dropzone.appendChild(img);

  showOcrPane('text');
  setStage('idle');
}

// ─────────────────────────────────────────────
// OCR
// ─────────────────────────────────────────────
async function runOcr() {
  if (!image) return;
  setStage('ocr-loading');
  showError('');
  setProgress('Sending to server…');

  const form = new FormData();
  form.append('image', image);
  try {
    const res  = await fetch(`${API}/api/ocr`, { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'OCR failed');

    ocrTextarea.value = data.text ?? '';
    rawData           = data.raw  ?? null;
    fullRawJson       = '';
    processedJson     = '';
    jsonLoadingTab    = null;
    codeEditor.value  = data.text ?? '';

    setProgress('Done.');
    showOcrPane('text');
    setStage('ocr-done');
  } catch (err) {
    showError(err.message);
    setProgress('');
    setStage('idle');
  }
  updateCopyBtn();
}

// ─────────────────────────────────────────────
// Run sketch
// ─────────────────────────────────────────────
function runSketch() {
  const code = codeEditor.value;
  if (!code.trim()) return;
  sketchConsole.innerHTML     = '';
  sketchConsole.style.display = 'none';
  sketchFrame.srcdoc          = '';
  setTimeout(() => {
    sketchFrame.srcdoc = buildSketchHtml(code);
    setStage('exec-done');
  }, 0);
}

// ─────────────────────────────────────────────
// Camera
// ─────────────────────────────────────────────
async function startCam() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    camVideo.srcObject       = stream;
    camWrapper.style.display = 'flex';
    dropzone.style.display   = 'none';
    camMode                  = true;
    btnCam.textContent       = 'Upload';
    camVideo.style.transform = `rotate(${camRotation}deg)`;
  } catch { stopCam(); }
}

function stopCam() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  camWrapper.style.display = 'none';
  dropzone.style.display   = 'flex';
  camMode                  = false;
  btnCam.textContent       = 'Webcam';
}

function takeShot() {
  const vw = camVideo.videoWidth, vh = camVideo.videoHeight;
  const swapped    = camRotation === 90 || camRotation === 270;
  camCanvas.width  = swapped ? vh : vw;
  camCanvas.height = swapped ? vw : vh;
  const ctx = camCanvas.getContext('2d');
  ctx.save();
  ctx.translate(camCanvas.width / 2, camCanvas.height / 2);
  ctx.rotate(camRotation * Math.PI / 180);
  ctx.drawImage(camVideo, -vw / 2, -vh / 2);
  ctx.restore();
  camCanvas.toBlob(blob => {
    if (!blob) return;
    stopCam();
    camRotation = 90;
    acceptFile(new File([blob], 'webcam-shot.jpg', { type: 'image/jpeg' }));
  }, 'image/jpeg', 0.95);
}

// ─────────────────────────────────────────────
// Event wiring
// ─────────────────────────────────────────────
btnUpload.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (file) acceptFile(file);
  fileInput.value = '';
});

dropzone.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('dragging'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('dragging');
  const file = e.dataTransfer.files?.[0];
  if (file) acceptFile(file);
});

btnCam.addEventListener('click', () => camMode ? stopCam() : startCam());
btnRotate.addEventListener('click', () => {
  camRotation = (camRotation + 90) % 360;
  camVideo.style.transform = `rotate(${camRotation}deg)`;
});
btnShot.addEventListener('click', takeShot);
btnOcr.addEventListener('click', runOcr);
btnRunSketch.addEventListener('click', runSketch);

codeEditor.addEventListener('input', () => {
  btnRunSketch.disabled = !codeEditor.value.trim();
});

tabText.addEventListener('click',      () => showOcrPane('text'));
tabProcessed.addEventListener('click', () => showOcrPane('processed'));
tabFull.addEventListener('click',      () => showOcrPane('full'));

btnCopyOcr.addEventListener('click', async () => {
  const content = ocrTab === 'text' ? ocrTextarea.value
                : ocrTab === 'full' ? fullRawJson
                : processedJson;
  if (content) { try { await navigator.clipboard.writeText(content); } catch {} }
});

window.addEventListener('message', e => {
  if (e.data?.source !== 'p5-sketch') return;
  addConsoleLog(e.data.level, e.data.message);
});

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
setStage('idle');
showOcrPane('text');
checkServerStatus();