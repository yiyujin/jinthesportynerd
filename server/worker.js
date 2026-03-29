import { spawn } from "child_process";
import { readFileSync, unlinkSync } from "fs";
import { randomUUID } from "crypto";

process.on("message", async ({ tmpIn, inputExt }) => {
  const tmpOut = `/tmp/out-${randomUUID()}.wav`;
  let stderrOutput = '';

  const ffmpeg = spawn("ffmpeg", [
    "-i", tmpIn,
    "-ar", "16000",
    "-ac", "1",
    "-f", "wav",
    tmpOut,
    "-y"
  ]);

  ffmpeg.stderr.on("data", (d) => { stderrOutput += d.toString(); });

  ffmpeg.on("close", (code) => {
    try { unlinkSync(tmpIn); } catch {}

    if (code !== 0) {
      process.send({ error: `ffmpeg failed (code ${code}): ${stderrOutput}` });
      return;
    }

    const audio = readFileSync(tmpOut);
    try { unlinkSync(tmpOut); } catch {}
    process.send({ audioBase64: audio.toString("base64") });
  });
});