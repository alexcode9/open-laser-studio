import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type Level = 'debug' | 'info' | 'warn' | 'error';

type Sink = (entry: { level: Level; message: string; tS: number }) => void;

let logFile: string | null = null;
const sinks: Sink[] = [];
const start = Date.now();

export function initLogger(dir: string): string {
  mkdirSync(dir, { recursive: true });
  logFile = join(dir, 'ols-main.log');
  return logFile;
}

export function addLogSink(s: Sink): void {
  sinks.push(s);
}

/** Structured JSON-lines logger for the main process. */
export function log(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  const entry = { ts: new Date().toISOString(), level, msg: message, ...fields };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  if (logFile) {
    try {
      appendFileSync(logFile, line + '\n');
    } catch {
      // Logging must never crash the app.
    }
  }
  if (level !== 'debug') {
    for (const s of sinks) s({ level, message, tS: (Date.now() - start) / 1000 });
  }
}
