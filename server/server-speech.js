import { SpeechClient } from '@google-cloud/speech';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import busboy from 'busboy';
import { exec } from 'child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.GOOGLE_APPLICATION_CREDENTIALS = 'handcoding-d22931371cca.json';

const app = express();
const speechClient = new SpeechClient();

app.use(cors());
app.use(express.static(__dirname));

app.get('/health', (req, res) => res.sendStatus(200));

// Helper: extract audio from video buffer using ffmpeg, returns WAV buffer
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

app.post('/upload-audio', (req, res) => handleUpload(req, res, 'audio'));
app.post('/upload-video', (req, res) => handleUpload(req, res, 'video'));

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

app.listen(3001, () => console.log('Server running: http://localhost:3001'));