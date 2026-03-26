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
import { exec } from 'child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import { randomUUID } from 'crypto';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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


// ---------- GET /api2/status ----------
app.get('/api2/status', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/health', (req, res) => res.sendStatus(200));


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


// ---------- Speech helpers ----------
function extractAudioFromVideo(videoBuffer, inputExt) {
  return new Promise((resolve, reject) => {
    const tmpIn  = `/tmp/${randomUUID()}.${inputExt}`;
    const tmpOut = `/tmp/${randomUUID()}.wav`;

    writeFileSync(tmpIn, videoBuffer);

    exec(`ffmpeg -i "${tmpIn}" -ar 16000 -ac 1 -f wav "${tmpOut}" -y`, (err) => {
      try { unlinkSync(tmpIn); } catch {}

      if (err) {
        try { unlinkSync(tmpOut); } catch {}
        return reject(err);
      }

      const audioBuffer = readFileSync(tmpOut);
      try { unlinkSync(tmpOut); } catch {}
      resolve(audioBuffer);
    });
  });
}

async function handleUpload(req, res, type) {
  const bb = busboy({ headers: req.headers });
  const chunks = [];
  let filename = '';

  bb.on('file', (name, stream, info) => {
    filename = info.filename || '';
    stream.on('data', chunk => chunks.push(chunk));
  });

  bb.on('close', async () => {
    try {
      let audioBytes;

      if (type === 'video') {
        const ext = path.extname(filename).replace('.', '').toLowerCase() || 'mp4';
        const videoBuffer = Buffer.concat(chunks);
        const audioBuffer = await extractAudioFromVideo(videoBuffer, ext);
        audioBytes = audioBuffer.toString('base64');
      } else {
        audioBytes = Buffer.concat(chunks).toString('base64');
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
      res.status(500).json({ success: false, error: error.message });
    }
  });

  req.pipe(bb);
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