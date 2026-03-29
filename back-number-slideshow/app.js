const API = "/api2";
// const API = "http://localhost:3001/api2";

async function checkServerStatus() {
  const img  = document.getElementById('server-status-img');
  const text = document.getElementById('server-status-text');
  try {
    const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      img.src      = '../public/shiba_awake.png';
      text.textContent = 'Server Awake';
      text.style.color = 'var(--success, rgb(0, 194, 71))';
    } else {
      img.src      = '../public/shiba_sleep.png';
      text.textContent = 'Server Asleep';
      text.style.color = 'var(--error, #e55)';
    }
  } catch {
    img.src      = '../public/shiba_sleep.png';
    text.textContent = 'Server Asleep';
    text.style.color = 'var(--error, #e55)';
  }
}

document.addEventListener('DOMContentLoaded', checkServerStatus);


import { exampleFiles, exampleData } from './exampleData.js';

// EXAMPLE 1
document.addEventListener('DOMContentLoaded', function() {
  const btnLoadExample = document.getElementById('btn-load-example');
  const thumbnailsDiv = document.getElementById('example-thumbnails');
  if (btnLoadExample && thumbnailsDiv) {
    btnLoadExample.addEventListener('click', async function() {
      thumbnailsDiv.innerHTML = '';

      const files = [];
      const gameNums = [4, 9, 10];
      for (const i of gameNums) {
        const url = `../public/backnumber/game${i}.jpg`;
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const blob = await res.blob();
          let file;
          try {
            file = new File([blob], `game${i}.jpg`, { type: blob.type });
          } catch (e) {
            file = blob;
            file.name = `game${i}.jpg`;
          }
          files.push(file);
        } catch (e) {
          // skip if not found
        }
      }
      if (files.length) {
        if (typeof acceptFiles === 'function') {
          acceptFiles(files);
        }
      }
    });
  }


  const EXAMPLE2_FILES = exampleFiles;
  const EXAMPLE2_PROCESSED = exampleData;

  const btnLoadExample2 = document.getElementById('btn-load-example2');
  if (btnLoadExample2) {
    btnLoadExample2.addEventListener('click', async function() {
      btnLoadExample2.disabled = true;
      btnLoadExample2.textContent = 'Loading…';

      const files = [];
      for (const name of EXAMPLE2_FILES) {
        const url = `../public/backnumber/${name}`;
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`${res.status}`);
          const blob = await res.blob();
          files.push(new File([blob], name, { type: blob.type }));
        } catch (e) {
          console.warn('Example2: could not load', name, e.message);
        }
      }

      btnLoadExample2.disabled = false;
      btnLoadExample2.textContent = 'Load Example2';

      if (!files.length) { alert('Could not load example images.'); return; }

      // Reset UI with these files (same as acceptFiles but we keep mock data)
      acceptFiles(files);

      // Now inject mock processed data — build ocrResults manually, skip server
      const mockResults = files.map((file, idx) => ({
        file,
        preview: previews[idx],
        rawOcr: EXAMPLE2_PROCESSED[idx].entries.map(e => e[0]).join(' '),
        rawData: null,            // no raw Document AI data
        _processedJson: JSON.stringify(EXAMPLE2_PROCESSED[idx], null, 2),
        _mockProcessed: EXAMPLE2_PROCESSED[idx], // used by getSlideshowItems
      }));

      ocrResults = mockResults;
      rawData = null;
      fullRawJson = '';
      processedJson = '';

      setProgress(`[Example2] Loaded ${files.length} images with Document AI ran JSON.`);

      if (mockResults.length === 1) {
        ocrTextarea.value = mockResults[0].rawOcr;
      } else {
        buildMultiTable(mockResults);
      }

      // Generate slideshow via getSlideshowItems (respects mode + target)
      const items = await getSlideshowItems(mockResults);

      codeEditor.value = generateSlideshowSketch(items);
      showOcrPane('text');
      setStage('ocr-done');
      updateCopyBtn();
    });
  }
});

let images      = [];
let previews    = [];
let ocrResults  = []; // {file, preview, rawOcr, rawData, error?}
let rawData     = null;
let fullRawJson = '';
let processedJson = '';
let stage       = 'idle';
let ocrTab      = 'text';
let camMode     = false;
let camRotation = 90;
let stream      = null;

// ─────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────
const btnCam          = document.getElementById('btn-cam');
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
const ocrTextPane     = document.getElementById('ocr-text-pane');
const ocrTextarea     = document.getElementById('ocr-textarea');
const ocrTablePane    = document.getElementById('ocr-table-pane');
const ocrTbody        = document.getElementById('ocr-tbody');
const ocrProcessed    = document.getElementById('ocr-processed-pane');
const ocrFull         = document.getElementById('ocr-full-pane');
const fullJsonMeta    = document.getElementById('full-json-meta');
const fullJsonPre     = document.getElementById('full-json-pre');
const codeEditor      = document.getElementById('code-editor');
const sketchFrame     = document.getElementById('sketch-frame');
const sketchConsole   = document.getElementById('sketch-console');
const ocrProgress     = document.getElementById('ocr-progress');

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
  if (!layout || typeof layout !== 'object') return { x:null, y:null, w:null, h:null };
  const bp = layout.boundingPoly;
  if (!bp || typeof bp !== 'object') return { x:null, y:null, w:null, h:null };
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
  if (!xs.length || !ys.length) return { x:null, y:null, w:null, h:null };
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

function getTargetNumber() {
  const el = document.getElementById('input-backnumber');
  return el ? el.value.trim() : '26';
}

function isNumericEntry(text) {
  return /^\d+$/.test(text.trim());
}

function findSpecificBox(processed, targetText) {
  if (!processed || !Array.isArray(processed.entries)) return null;
  for (const entry of processed.entries) {
    if (entry[0] === targetText && entry[1] != null && entry[2] != null && entry[3] != null && entry[4] != null)
      return { x: entry[1], y: entry[2], w: entry[3], h: entry[4] };
  }
  return null;
}

function findAllNumberBoxes(processed) {
  if (!processed || !Array.isArray(processed.entries)) return [];
  return processed.entries
    .filter(e => isNumericEntry(e[0]) && e[1] != null && e[2] != null && e[3] != null && e[4] != null)
    .map(e => ({ text: e[0], box: { x: e[1], y: e[2], w: e[3], h: e[4] } }));
}

function find26Box(processed) {
  return findSpecificBox(processed, getTargetNumber());
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

async function getSlideshowItems(results) {
  const anyMode = document.getElementById('chk-any-number')?.checked ?? false;
  const target  = getTargetNumber();

  const allItems = [];
  for (const res of results) {
    const dataUrl = await fileToDataUrl(res.file);
    let processed = res._mockProcessed || null;
    if (!processed && res.rawData) processed = extractProcessedEntries(res.rawData);
    const imageSize = processed?.imageSize || { width: null, height: null };

    if (anyMode) {
      if (processed) {
        const excludeSet = getExcludeSet();
        const numberBoxes = findAllNumberBoxes(processed);
        if (numberBoxes.length > 0) {
          for (const { text, box } of numberBoxes) {
            if (excludeSet.has(text)) continue;
            allItems.push({ file: res.file, preview: dataUrl, box26: box, imageSize, label: text });
          }
        }
        // else: no numbers found → skip this image entirely
      }
    } else {
      const box = processed ? findSpecificBox(processed, target) : null;
      allItems.push({ file: res.file, preview: dataUrl, box26: box, imageSize, label: target });
    }
  }
  return allItems;
}

// ─────────────────────────────────────────────
// Sketch generation
// ─────────────────────────────────────────────

function generateSlideshowSketch(items, intervalMs = 500, targetBoxSize = 100) {
  // De-duplicate data URLs so same image isn't embedded multiple times
  const urlToVar = {};
  let imageVars = '', loadImages = '';
  let varCount = 0;
  items.forEach(item => {
    if (!urlToVar[item.preview]) {
      const varName = 'img' + varCount++;
      urlToVar[item.preview] = varName;
      imageVars  += 'let ' + varName + ';\n';
      loadImages += varName + ' = loadImage("' + item.preview + '");\n';
    }
  });
  const slideVars  = JSON.stringify(items.map(i => urlToVar[i.preview]));
  const boxes      = JSON.stringify(items.map(i => i.box26));
  const widths     = JSON.stringify(items.map(i => i.imageSize.width  || 640));
  const heights    = JSON.stringify(items.map(i => i.imageSize.height || 480));
  const labels     = JSON.stringify(items.map(i => i.label || ''));
  const total      = items.length;

return `
const CANVAS_W = 640;
const CANVAS_H = 480;

const TARGET_BOX_SIZE = ${targetBoxSize};
let intervalMs = ${intervalMs};

let slideIndex = 0;
let nextSlideAt = 0;

` + imageVars + `
function preload() {
` + loadImages + `}
function setup() {
  createCanvas(CANVAS_W, CANVAS_H);
  frameRate(60);
  nextSlideAt = millis() + intervalMs;
}
function draw() {
  background(20);
  if (` + total + ` === 0) {
    fill(230); textAlign(CENTER,CENTER); textSize(16);
    text('No images', width/2, height/2); return;
  }
  if (millis() >= nextSlideAt) {
    slideIndex = (slideIndex + 1) % ` + total + `;
    nextSlideAt = millis() + intervalMs;
  }
  let idx = slideIndex;
  let _svars = ` + slideVars + `;
  let img = eval(_svars[idx]);
  let box = ` + boxes + `[idx];
  let imgW = ` + widths + `[idx];
  let imgH = ` + heights + `[idx];
  let label = ` + labels + `[idx];
  if (!img) return;
  let scale = 1;
  let cx = imgW/2, cy = imgH/2;
  if (box) {
    let boxSize = Math.max(box.w, box.h);
    scale = TARGET_BOX_SIZE / boxSize;
    cx = box.x + box.w/2;
    cy = box.y + box.h/2;
  }
  let drawW = imgW * scale;
  let drawH = imgH * scale;
  let dx = width/2 - cx*scale;
  let dy = height/2 - cy*scale;

  push();
  translate(dx, dy);
  image(img, 0, 0, drawW, drawH);
  pop();

  // DRAW BOUNDING BOX
  // push();
  // translate(dx, dy);

  // stroke('lime');
  // stroke('#ff00e5');
  // strokeWeight(2);
  // noFill();
  // if (box) rect(box.x * scale, box.y * scale, box.w * scale, box.h * scale);
  // pop();

  // CARTOON LINES
  push();
  translate(dx, dy);

  if (box) {
let ratio = 2;
let bx = box.x * scale;
let by = box.y * scale;
let bw = box.w * scale;
let bh = box.h * scale;
let bcx = bx + bw / 2;
let bcy = by + bh / 2;

bx = bcx - (bw * ratio) / 2;
by = bcy - (bh * ratio) / 2;
bw = bw * ratio;
bh = bh * ratio;

    // Sample points around the box perimeter
    let perimeterPoints = [];
    let steps = 10;
let sws = [1,2,4,10,2,2,1,1,1,4,5,10,6,2,5];
    // top and bottom edges
    for (let i = 0; i <= steps; i++) {
      let t = i / steps;
      perimeterPoints.push([bx + t * bw, by]);          // top
      perimeterPoints.push([bx + t * bw, by + bh]);     // bottom
    }
    // left and right edges
    for (let i = 1; i < steps; i++) {
      let t = i / steps;
      perimeterPoints.push([bx,      by + t * bh]);     // left
      perimeterPoints.push([bx + bw, by + t * bh]);     // right
    }

    let lineLen = max(drawW, drawH) * 0.8;

stroke(0);
let si = 0;
for (let [px, py] of perimeterPoints) {
  let angle = atan2(py - bcy, px - bcx);
  let ex = px + cos(angle) * lineLen;
  let ey = py + sin(angle) * lineLen;
  strokeWeight(sws[si % sws.length]);
  strokeCap(SQUARE);
  line(px, py, ex, ey);
  si++;
}
  }

  pop();


  fill(255); rect(0,0,width,28); fill(20);
  textAlign(LEFT,CENTER); textSize(12);
  text('Slide '+(idx+1)+'/` + total + `', 10, 14);
  if (label) { textAlign(RIGHT,CENTER); text('#'+label, width-10, 14); }
}`;
}

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
  <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.11.2/p5.min.js"></scr${''}ipt>
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
  </scr${''}ipt>
  <script>
${userCode}
  </scr${''}ipt>
</body>
</html>`;
}

function setProgress(msg, isError = false) {
  if (!ocrProgress) return;
  ocrProgress.textContent = msg;
  ocrProgress.style.color = isError ? 'var(--error, #e55)' : 'var(--fg-muted, #888)';
  ocrProgress.style.display = msg ? '' : 'none';
}

function setStage(s) {
  stage = s;
  btnOcr.disabled       = images.length === 0 || stage === 'ocr-loading';
  btnOcr.textContent    = stage === 'ocr-loading' ? 'Serving...' : 'Send Request';
  // Snapshot value BEFORE disabling the textarea (disabled textarea returns '' in some browsers)
  const codeVal = codeEditor.value.trim();
  codeEditor.disabled      = stage === 'idle' || stage === 'ocr-loading';
  btnRunSketch.disabled    = !codeVal;
}

function showOcrPane(tab) {
  ocrTab = tab;
  ocrTextPane.style.display  = 'none';
  ocrTablePane.style.display = 'none';
  ocrProcessed.style.display = 'none';
  ocrFull.style.display      = 'none';
  tabText.classList.remove('active');
  tabProcessed.classList.remove('active');
  tabFull.classList.remove('active');

  if (tab === 'text') {
    tabText.classList.add('active');
    if (ocrResults.length > 1) {
      ocrTablePane.style.display = 'block';
    } else {
      ocrTextPane.style.display = 'block';
    }
  } else if (tab === 'processed') {
    tabProcessed.classList.add('active');
    if (ocrResults.length > 1) {
      ocrTablePane.style.display = 'block';
    } else {
      ocrProcessed.style.display = 'block';
      if (!processedJson && rawData) {
        tabProcessed.textContent = 'Processed JSON..';
        setTimeout(() => {
          processedJson = JSON.stringify(extractProcessedEntries(rawData), null, 2);
          ocrProcessed.textContent = processedJson;
          tabProcessed.textContent = 'Processed JSON';
          updateCopyBtn();
        }, 0);
      } else {
        ocrProcessed.textContent = processedJson;
      }
    }
  } else if (tab === 'full') {
    tabFull.classList.add('active');
    if (ocrResults.length > 1) {
      ocrTablePane.style.display = 'block';
    } else {
      ocrFull.style.display = 'block';
      if (!fullRawJson && rawData) {
        tabFull.textContent = 'Full Raw JSON..';
        setTimeout(() => {
          fullRawJson = JSON.stringify(rawData, null, 2);
          fullJsonMeta.textContent = 'Length: ' + fullRawJson.length;
          fullJsonPre.textContent  = fullRawJson.split('\n').slice(0, 10).join('\n');
          tabFull.textContent = 'Full Raw JSON';
          updateCopyBtn();
        }, 0);
      } else {
        fullJsonMeta.textContent = 'Length: ' + fullRawJson.length;
        fullJsonPre.textContent  = fullRawJson.split('\n').slice(0, 10).join('\n');
      }
    }
  }
  updateCopyBtn();
}

function updateCopyBtn() {
  if (ocrTab === 'text')      btnCopyOcr.disabled = !ocrTextarea.value;
  else if (ocrTab === 'full') btnCopyOcr.disabled = !fullRawJson;
  else                        btnCopyOcr.disabled = !processedJson;
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
// Copy helper
// ─────────────────────────────────────────────
async function copyToClipboard(text, btn) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1200);
  } catch {}
}

// ─────────────────────────────────────────────
// Multi-image table builder
// ─────────────────────────────────────────────
function buildMultiTable(results) {
  ocrTbody.innerHTML = '';

  results.forEach((res, idx) => {
    const tr = document.createElement('tr');
    tr.setAttribute('data-idx', idx);

    // -- Preview cell --
    const tdPrev = document.createElement('td');
    const imgEl = document.createElement('img');
    imgEl.src = res.preview;
    imgEl.style.cssText = 'max-width:80px;max-height:80px;display:block';
    tdPrev.appendChild(imgEl);
    tr.appendChild(tdPrev);

    // -- File name cell --
    const tdName = document.createElement('td');
    tdName.textContent = res.file.name;
    tr.appendChild(tdName);

    // -- OCR Text cell (plain text, safe to show immediately) --
    const tdText = document.createElement('td');
    if (res.error) {
      tdText.innerHTML = `<span style="color:var(--error,#e55)">${res.error}</span>`;
    } else {
      tdText.appendChild(makeLazyCell(() => res.rawOcr || '', 'text', idx));
    }
    tr.appendChild(tdText);

    // -- Processed JSON cell (deferred stringify) --
    const tdProc = document.createElement('td');
    if (!res.error && (res.rawData || res._processedJson)) {
      tdProc.appendChild(makeLazyCell(() => {
        if (res._processedJson) return res._processedJson;
        if (!res._processedJson && res.rawData)
          res._processedJson = JSON.stringify(extractProcessedEntries(res.rawData), null, 2);
        return res._processedJson || '';
      }, 'processed', idx));
    } else {
      tdProc.innerHTML = '<span style="color:#888">—</span>';
    }
    tr.appendChild(tdProc);

    // -- Full Raw JSON cell (deferred stringify) --
    const tdFull = document.createElement('td');
    if (!res.error && res.rawData) {
      tdFull.appendChild(makeLazyCell(() => {
        if (!res._fullJson)
          res._fullJson = JSON.stringify(res.rawData, null, 2);
        return res._fullJson;
      }, 'full', idx));
    } else {
      tdFull.innerHTML = '<span style="color:#888">—</span>';
    }
    tr.appendChild(tdFull);

    ocrTbody.appendChild(tr);
  });
}

// Renders a "Show" button; only builds the textarea when clicked.
function makeLazyCell(getContent, type, idx) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;min-width:120px';

  const showBtn = document.createElement('button');
  showBtn.textContent = 'Show';
  showBtn.style.cssText = 'align-self:flex-start;font-size:11px;padding:2px 10px';

  showBtn.addEventListener('click', () => {
    // Compute content lazily — JSON.stringify only runs here
    const content = getContent();

    const ta = document.createElement('textarea');
    ta.className = 'code-area code-area-ocr';
    ta.readOnly = true;
    ta.spellcheck = false;
    ta.value = content;
    ta.style.cssText = 'min-width:160px;min-height:80px;resize:vertical;font-size:11px';
    ta.setAttribute('data-type', type);
    ta.setAttribute('data-idx', idx);

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.style.cssText = 'align-self:flex-end;font-size:11px;padding:2px 8px';
    copyBtn.addEventListener('click', () => copyToClipboard(ta.value, copyBtn));

    const hideBtn = document.createElement('button');
    hideBtn.textContent = 'Hide';
    hideBtn.style.cssText = 'align-self:flex-end;font-size:11px;padding:2px 8px';
    hideBtn.addEventListener('click', () => {
      ta.remove();
      copyBtn.remove();
      hideBtn.remove();
      showBtn.style.display = '';
    });

    showBtn.style.display = 'none';
    wrap.appendChild(ta);
    wrap.appendChild(copyBtn);
    wrap.appendChild(hideBtn);
  });

  wrap.appendChild(showBtn);
  return wrap;
}

// legacy signature kept in case anything calls it directly
function makeJsonCell(content, type, idx) {
  return makeLazyCell(() => content, type, idx);
}


// FILE MANAGEMENT
function acceptFiles(files) {
  images = files;
  previews.forEach(u => URL.revokeObjectURL(u));
  previews = files.map(f => URL.createObjectURL(f));
  ocrResults    = [];
  rawData       = null;
  fullRawJson   = '';
  processedJson = '';
  ocrTextarea.value        = '';
  ocrTbody.innerHTML       = '';
  ocrProcessed.textContent = '';
  fullJsonPre.textContent  = '';
  codeEditor.value         = '';

  sketchConsole.innerHTML  = '';
  sketchConsole.style.display = 'none';
  showError('');
  setProgress('');

  dropzone.innerHTML = '';

  if (previews.length) {
    previews.forEach(src => {
      const img = document.createElement('img');
      img.src       = src;
      img.className = 'preview-img';
      dropzone.appendChild(img);
    });
  } else {
    dropzone.innerHTML = '<span>Click or drag images here</span>';
  }
  dropzone.appendChild(fileInput);

  showOcrPane('text');
  setStage('idle');
}

// ─────────────────────────────────────────────
// OCR
// ─────────────────────────────────────────────
async function runOcr() {
  if (!images.length) return;
  setStage('ocr-loading');
  showError('');
  setProgress(`Starting OCR for ${images.length} image${images.length > 1 ? 's' : ''}…`);

  const results = [];
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    setProgress(`[${i + 1}/${images.length}] Sending "${image.name}" to Document AI…`);

    const form = new FormData();
    form.append('image', image);
    const t0 = Date.now();
    try {
      const res  = await fetch(`${API}/ocr`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'OCR failed');

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const textLen = (data.text ?? '').length;
      const pages   = data.raw?.pages?.length ?? 0;

      setProgress(`[${i + 1}/${images.length}] ✅ OCR done — text length: ${textLen} | pages: ${pages} | ${elapsed}s`);

      results.push({ file: image, preview: previews[i], rawOcr: data.text ?? '', rawData: data.raw ?? null });
    } catch (err) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      setProgress(`[${i + 1}/${images.length}] ❌ Error: ${err.message} | ${elapsed}s`, true);
      results.push({ file: image, preview: previews[i], rawOcr: '', rawData: null, error: err.message });
    }
  }

  ocrResults = results;
  setProgress(`Done — ${results.length} image${results.length > 1 ? 's' : ''} processed.`);

  if (results.length === 1) {
    ocrTextarea.value = results[0].rawOcr || '';
    rawData = results[0].rawData;
  } else {
    rawData = results[0]?.rawData ?? null;
    buildMultiTable(results);
  }

  fullRawJson = '';
  processedJson = '';

  const items = await getSlideshowItems(results);
  codeEditor.value = generateSlideshowSketch(items);

  showOcrPane('text');
  setStage('ocr-done');
  updateCopyBtn();
}

// ─────────────────────────────────────────────
// Run sketch
// ─────────────────────────────────────────────
function runSketch(code) {
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
    camVideo.srcObject        = stream;
    camWrapper.style.display  = 'flex';
    dropzone.style.display    = 'none';
    camMode                   = true;
    btnCam.textContent        = 'Upload';
    camVideo.style.transform  = `rotate(${camRotation}deg)`;
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
  const swapped      = camRotation === 90 || camRotation === 270;
  camCanvas.width    = swapped ? vh : vw;
  camCanvas.height   = swapped ? vw : vh;
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
    acceptFiles([new File([blob], 'webcam-shot.jpg', { type: 'image/jpeg' })]);
  }, 'image/jpeg', 0.95);
}

// ─────────────────────────────────────────────
// Event wiring
// ─────────────────────────────────────────────
dropzone.addEventListener('click', e => { if (e.target !== fileInput) fileInput.click(); });
fileInput.addEventListener('change', e => {
  const files = Array.from(e.target.files || []);
  if (files.length) acceptFiles(files);
  fileInput.value = '';
});
dropzone.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('dragging'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('dragging');
  const files = Array.from(e.dataTransfer.files || []);
  if (files.length) acceptFiles(files);
});

btnOcr.addEventListener('click', runOcr);
btnRunSketch.addEventListener('click', async () => {
  if (ocrResults.length) {
    const code = codeEditor.value;
    // Extract intervalMs and TARGET_BOX_SIZE from the current code
    const intervalMatch = code.match(/let\s+intervalMs\s*=\s*(\d+(?:\.\d+)?)/);
    const boxSizeMatch = code.match(/const\s+TARGET_BOX_SIZE\s*=\s*(\d+(?:\.\d+)?)/);
    const currentInterval = intervalMatch ? Number(intervalMatch[1]) : 500;
    const currentBoxSize = boxSizeMatch ? Number(boxSizeMatch[1]) : 100;
    const items = await getSlideshowItems(ocrResults);
    const newCode = generateSlideshowSketch(items, currentInterval, currentBoxSize);
    codeEditor.value = newCode;
    runSketch(newCode);
  } else {
    runSketch(codeEditor.value);
  }
});

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

// Init
setStage('idle');
showOcrPane('text');


function getExcludeSet() {
  const el = document.getElementById('input-exclude');
  if (!el || !el.value.trim()) return new Set();
  return new Set(el.value.split(',').map(s => s.trim()).filter(Boolean));
}