import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import { SpeechClient } from '@google-cloud/speech';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';
import { exec } from 'child_process';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json());


app.get('/api2/status', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/health', (req, res) => res.sendStatus(200));

// Store uploaded files in memory
const upload = multer({ storage: multer.memoryStorage() });

// ---------- Document AI client ----------
const docClient = new DocumentProcessorServiceClient({
  keyFilename: path.join(__dirname, 'handcoding-d22931371cca.json'),
});

const PROCESSOR_NAME = `projects/handcoding/locations/us/processors/${process.env.PROCESSOR_ID}`;

// ---------- Speech-to-Text client ----------
const speechClient = new SpeechClient({
  keyFilename: path.join(__dirname, 'handcoding-d22931371cca.json'), // same JSON can be used
});

// ---------- POST /api/ocr ----------
app.post('/api/ocr', upload.single('image'), async (req, res) => {
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


// ---------- POST /api/stt ----------
app.post('/api/stt', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio/video file provided.' });

  const originalName = req.file.originalname;
  const tempFile = path.join('./', `temp_${Date.now()}_${originalName}`);
  fs.writeFileSync(tempFile, req.file.buffer);

  let audioFile = tempFile; // file to send to STT

  try {
    const ext = path.extname(originalName).toLowerCase();

    // Convert to WAV PCM16 if not WAV/FLAC
    if (!['.wav', '.flac'].includes(ext)) {
      const convertedFile = tempFile.replace(ext, '.wav');
      await new Promise((resolve, reject) => {
        exec(
          `ffmpeg -y -i "${tempFile}" -ac 1 -ar 44100 -c:a pcm_s16le "${convertedFile}"`,
          (err, stdout, stderr) => {
            if (err) {
              console.error('FFmpeg conversion error:', stderr);
              return reject(new Error('FFmpeg conversion failed'));
            }
            resolve(stdout);
          }
        );
      });
      audioFile = convertedFile;
    }

    // Read file after conversion
    const audioBytes = fs.readFileSync(audioFile).toString('base64');

    // Call Google STT
    const request = {
      audio: { content: audioBytes },
      config: {
        encoding: 'LINEAR16', // matches PCM16 WAV
        sampleRateHertz: 44100,
        languageCode: 'en-US',
        enableAutomaticPunctuation: true,
      },
    };

    const [response] = await speechClient.recognize(request);

    // Join all results
    const transcription = response.results
      .map(result => result.alternatives[0]?.transcript ?? '')
      .filter(Boolean)
      .join('\n');

    // Cleanup temp files **after STT completes**
    try { fs.unlinkSync(tempFile); } catch {}
    if (audioFile !== tempFile) {
      try { fs.unlinkSync(audioFile); } catch {}
    }

    res.json({ transcription, raw: response });
  } catch (err) {
    console.error('Speech-to-Text error:', err);

    // Cleanup even on error
    try { fs.unlinkSync(tempFile); } catch {}
    if (audioFile && audioFile !== tempFile) {
      try { fs.unlinkSync(audioFile); } catch {}
    }

    res.status(500).json({ error: 'STT failed', details: err.message });
  }
});



// ---------- POST /api/execute ----------
app.post('/api/execute', (req, res) => {
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

// ---------- Helpers ----------
function stringify(val) {
  if (typeof val === 'object' && val !== null) {
    try { return JSON.stringify(val, null, 2); } catch { return String(val); }
  }
  return String(val);
}

// ---------- Start Server ----------
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running at endpoint ${API} at port ${PORT}`));