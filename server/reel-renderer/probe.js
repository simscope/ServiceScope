import { readFile, stat } from 'node:fs/promises';
import { reelPresentationSpec } from '../../src/features/reel-director/presentationSpec.js';
import { ReelRenderError } from './errors.js';
import { runBinary } from './process.js';

const minOutputBytes = 20_000;
const maxOutputBytes = 64 * 1024 * 1024;

export async function validateRenderedVideo(videoPath, expectedDurationMs, ffprobeBin, timeoutMs) {
  const result = await runBinary(ffprobeBin, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', videoPath], { timeoutMs });
  let probe;
  try {
    probe = JSON.parse(result.stdout);
  } catch {
    throw new ReelRenderError('REEL_RENDER_OUTPUT_INVALID');
  }
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const videoStreams = streams.filter((stream) => stream.codec_type === 'video');
  const audioStreams = streams.filter((stream) => stream.codec_type === 'audio');
  const stream = videoStreams[0];
  const file = await stat(videoPath);
  const durationMs = Math.round(Number(probe.format?.duration ?? stream?.duration) * 1000);
  const fps = parseRate(stream?.avg_frame_rate || stream?.r_frame_rate);
  if (streams.length !== 1 || videoStreams.length !== 1 || audioStreams.length !== 0
    || stream?.codec_name !== 'h264' || stream?.width !== reelPresentationSpec.width
    || stream?.height !== reelPresentationSpec.height || stream?.pix_fmt !== 'yuv420p'
    || Math.abs(fps - reelPresentationSpec.fps) > 0.01
    || !Number.isFinite(durationMs) || Math.abs(durationMs - expectedDurationMs) > 100
    || file.size < minOutputBytes || file.size > maxOutputBytes
    || !(await hasFaststart(videoPath))) {
    throw new ReelRenderError('REEL_RENDER_OUTPUT_INVALID');
  }
  return {
    durationMs,
    width: stream.width,
    height: stream.height,
    fps,
    videoCodec: stream.codec_name,
    pixelFormat: stream.pix_fmt,
    audioStreams: audioStreams.length,
    fileSize: file.size,
    faststart: true,
  };
}

function parseRate(value) {
  const [numerator, denominator] = String(value ?? '').split('/').map(Number);
  return denominator ? numerator / denominator : Number(value);
}

async function hasFaststart(path) {
  const buffer = await readFile(path);
  const moov = buffer.indexOf(Buffer.from('moov'));
  const mdat = buffer.indexOf(Buffer.from('mdat'));
  return moov > 0 && mdat > 0 && moov < mdat;
}
