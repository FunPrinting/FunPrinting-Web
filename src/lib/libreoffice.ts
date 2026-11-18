import 'server-only';
import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

/**
 * LibreOffice (soffice) on the server, for local and self-hosted deployments.
 * Not available on Vercel. Runs without a shell, in a fresh temp folder, with a
 * timeout, and always cleans up.
 */

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 90_000;
let available: Promise<boolean> | null = null;

function binary() {
  return process.env.LIBREOFFICE_PATH || 'soffice';
}

export function isLibreOfficeAvailable(): Promise<boolean> {
  if (process.env.VERCEL) return Promise.resolve(false);
  if (!available) {
    available = execFileAsync(binary(), ['--version'], { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
  }
  return available;
}

async function convert(input: Buffer, from: 'docx' | 'pdf', to: 'pdf' | 'docx'): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fp-lo-'));
  try {
    const inputPath = path.join(dir, `input.${from}`);
    await fs.writeFile(inputPath, input);
    // A per-run profile lets conversions run in parallel
    await execFileAsync(
      binary(),
      ['--headless', '--norestore', `-env:UserInstallation=file://${dir}/profile`, '--convert-to', to, '--outdir', dir, inputPath],
      { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }
    );
    return await fs.readFile(path.join(dir, `input.${to}`));
  } catch (err) {
    throw new Error(`LibreOffice conversion failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export const convertDocxToPdf = (docx: Buffer) => convert(docx, 'docx', 'pdf');
export const convertPdfToDocx = (pdf: Buffer) => convert(pdf, 'pdf', 'docx');
