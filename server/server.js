import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import { SpeechClient } from '@google-cloud/speech';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import busboy from 'busboy';
import { execFile } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';

import { fork } from "child_process";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ffmpegWorker = fork(path.join(__dirname, "worker.js"));

process.env.GOOGLE_APPLICATION_CREDENTIALS = 'handcoding-d22931371cca.json';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Store uploaded files in memory
const upload = multer({ storage: multer.memoryStorage() });

// ---------- Document AI client ----------
const docClient = new DocumentProcessorServiceClient({
  keyFilename: path.join(__dirname, 'handcoding-d22931371cca.json'),
});

const PROCESSOR_NAME = `projects/handcoding/locations/us/processors/${process.env.PROCESSOR_ID}`;

// ---------- Speech client ----------
const speechClient = new SpeechClient();




app.get('/api2/health', (req, res) => res.sendStatus(200));


// ---------- POST /api2/ocr ----------
app.post('/api2/ocr', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided.' });

  try {
    const [result] = await docClient.processDocument({
      name: PROCESSOR_NAME,
      rawDocument: {
        content: req.file.buffer.toString('base64'),
        mimeType: req.file.mimetype,
      },
    });

    const text = result.document?.text ?? '';
    const raw = result.document?.toJSON ? result.document.toJSON() : JSON.parse(JSON.stringify(result.document ?? {}));
    console.log('✅ OCR done — text length:', text.length, '| pages:', raw.pages?.length ?? 0);
    res.json({ text, raw });
  } catch (err) {
    console.error('Document AI error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ---------- POST /api2/execute ----------
app.post('/api2/execute', (req, res) => {
  const { code } = req.body;
  if (typeof code !== 'string') return res.status(400).json({ error: 'No code provided.' });

  const logs = [];
  const sandbox = {
    console: {
      log: (...args) => logs.push(args.map(stringify).join(' ')),
      error: (...args) => logs.push('[error] ' + args.map(stringify).join(' ')),
      warn: (...args) => logs.push('[warn] ' + args.map(stringify).join(' ')),
      info: (...args) => logs.push('[info] ' + args.map(stringify).join(' ')),
    },
    Math, JSON,
    parseInt, parseFloat, isNaN, isFinite,
    String, Number, Boolean,
    Array, Object, Date, RegExp, Error, Map, Set, Promise,
  };

  vm.createContext(sandbox);

  try {
    const script = new vm.Script(code);
    const result = script.runInContext(sandbox, { timeout: 5000 });
    res.json({
      output: logs.join('\n'),
      result: result !== undefined ? stringify(result) : null,
    });
  } catch (err) {
    res.json({ output: logs.join('\n'), error: err.message });
  }
});



function extractAudioFromVideo(videoBuffer, inputExt) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const tmpIn = `/tmp/in-${id}.${inputExt}`;
    const tmpOut = `/tmp/out-${id}.wav`;

    console.log('Writing video buffer, size:', videoBuffer.length, 'to', tmpIn);
    console.log('typeof videoBuffer:', typeof videoBuffer);
    console.log('is Buffer:', Buffer.isBuffer(videoBuffer));
    console.log('size:', videoBuffer?.length);
    writeFileSync(tmpIn, videoBuffer);

    execFile('ffmpeg', [
      '-loglevel', 'error',
      '-i', tmpIn,
      '-ar', '16000',
      '-ac', '1',
      '-f', 'wav',
      tmpOut,
      '-y'
    ], (err, stdout, stderr) => {
      if (err) {
        console.error('ffmpeg error:', stderr);
        try { unlinkSync(tmpIn); } catch {}
        return reject(new Error(`ffmpeg failed: ${stderr}`));
      }

      const audio = readFileSync(tmpOut);
      try { unlinkSync(tmpIn); } catch {}
      try { unlinkSync(tmpOut); } catch {}
      resolve(audio);
    });
  });
}

async function handleUpload(req, res, type) {
  const bb = busboy({ headers: req.headers });
  const chunks = [];
  let filename = '';
  let mimeType = '';

  await new Promise((resolve, reject) => {
    bb.on('file', (name, stream, info) => {
      filename = info.filename || '';
      mimeType = info.mimeType || '';
      console.log('File info:', info);

      stream.on('data', chunk => {
        chunks.push(chunk);
        console.log('Got chunk:', chunk.length);
      });

      stream.on('end', () => console.log('Stream ended, chunks:', chunks.length));
      stream.on('error', reject);
    });

    bb.on('close', resolve);
    bb.on('error', reject);
    req.pipe(bb);
  });

  try {
    const fileBuffer = Buffer.concat(chunks);
    console.log('Final buffer size:', fileBuffer.length);

    if (fileBuffer.length === 0) {
      return res.status(400).json({ error: 'Empty file received' });
    }

    let audioBytes;

    if (type === 'video') {
      const mimeToExt = {
        'video/webm': 'webm',
        'video/mp4': 'mp4',
        'video/quicktime': 'mov',
        'video/x-msvideo': 'avi',
      };
      const ext = mimeToExt[mimeType]
        || path.extname(filename).replace('.', '').toLowerCase()
        || 'mp4';

      console.log('Detected ext:', ext, '| mimeType:', mimeType, '| filename:', filename);

      const audioBuffer = await extractAudioFromVideo(fileBuffer, ext);
      audioBytes = audioBuffer.toString('base64');
    } else {
      audioBytes = fileBuffer.toString('base64');
    }

    const [response] = await speechClient.recognize({
      audio: { content: audioBytes },
      config: {
        encoding: type === 'video' ? 'LINEAR16' : 'MP3',
        sampleRateHertz: type === 'video' ? 16000 : undefined,
        languageCode: 'en-US',
        enableWordTimeOffsets: true,
        enableWordConfidence: true,
        enableAutomaticPunctuation: true,
      },
    });

    const transcript = response.results
      .map(r => r.alternatives[0].transcript)
      .join('\n');

    const processed = response.results.map(result => {
      const alt = result.alternatives[0];
      return {
        transcript: alt.transcript,
        confidence: alt.confidence,
        words: alt.words.map(w => ({
          word:       w.word,
          confidence: w.confidence,
          start:      parseFloat(w.startTime?.seconds || 0) + (w.startTime?.nanos || 0) / 1e9,
          end:        parseFloat(w.endTime?.seconds   || 0) + (w.endTime?.nanos   || 0) / 1e9,
        }))
      };
    });

    res.json({
      success: true,
      transcript,
      processed,
      raw: JSON.parse(JSON.stringify(response))
    });

  } catch (error) {
    console.error('handleUpload error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}


// ---------- POST /api2/upload-audio ----------
app.post('/api2/upload-audio', (req, res) => handleUpload(req, res, 'audio'));

// ---------- POST /api2/upload-video ----------
app.post('/api2/upload-video', (req, res) => handleUpload(req, res, 'video'));


// ---------- Helpers ----------
function stringify(val) {
  if (typeof val === 'object' && val !== null) {
    try { return JSON.stringify(val, null, 2); } catch { return String(val); }
  }
  return String(val);
}

// ---------- Start Server ----------
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));