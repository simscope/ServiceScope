import { spawn } from 'node:child_process';
import { ReelRenderError } from './errors.js';

const maxCapturedBytes = 64 * 1024;

export function runBinary(executable, args, { timeoutMs = 120_000 } = {}) {
  if (typeof executable !== 'string' || !executable || !Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    return Promise.reject(new ReelRenderError('REEL_RENDER_FAILED'));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = Buffer.alloc(0);
    let stderrBytes = 0;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      if (stdout.length < maxCapturedBytes) stdout = Buffer.concat([stdout, chunk.subarray(0, maxCapturedBytes - stdout.length)]);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes = Math.min(maxCapturedBytes, stderrBytes + chunk.length);
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(new ReelRenderError(timedOut ? 'REEL_RENDER_TIMEOUT' : 'REEL_RENDER_FAILED'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new ReelRenderError('REEL_RENDER_TIMEOUT'));
      if (code !== 0) return reject(new ReelRenderError('REEL_RENDER_FAILED'));
      resolve({ stdout: stdout.toString('utf8'), stderrBytes });
    });
  });
}
