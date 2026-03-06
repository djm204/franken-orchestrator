/**
 * BeastLogger — Reusable color-coded logger for FRANKENBEAST CLI.
 *
 * Uses raw ANSI escape codes (no external dependencies).
 * Provides formatted log levels, budget bars, status badges,
 * boxed headers, and service highlighting for verbose mode.
 */

import type { ILogger } from '../deps.js';

// ── ANSI escape codes ──

const A = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
} as const;

// ── Utility functions ──

/** Strip all ANSI escape codes for plain-text output (e.g. log files). */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Budget bar: `[████████░░░░░░░░░░░░] 50% ($5.00/$10)`
 * Color: green <50%, yellow 50-75%, red ≥90%.
 */
export function budgetBar(spent: number, limit: number): string {
  const pct = Math.min(spent / limit, 1);
  const w = 20;
  const filled = Math.round(pct * w);
  const empty = w - filled;
  const barColor = pct >= 0.9 ? A.red : pct >= 0.75 ? A.yellow : A.green;
  return `${barColor}[${'█'.repeat(filled)}${A.gray}${'░'.repeat(empty)}${barColor}]${A.reset} ${Math.round(pct * 100)}% ($${spent.toFixed(2)}/$${limit.toFixed(0)})`;
}

/** Status badge: ` PASS ` on green bg or ` FAIL ` on red bg. */
export function statusBadge(pass: boolean): string {
  return pass
    ? `${A.bgGreen}${A.bold} PASS ${A.reset}`
    : `${A.bgRed}${A.bold} FAIL ${A.reset}`;
}

/** Boxed header with `─` and `│` border characters in cyan. */
export function logHeader(title: string): string {
  const line = `${A.cyan}${'─'.repeat(60)}${A.reset}`;
  return `\n${line}\n${A.cyan}│${A.reset} ${A.bold}${title}${A.reset}\n${line}`;
}

// ── Banner ──

export const BANNER = `\n${A.green}${A.bold}` +
  '######## ########     ###    ##    ## ##    ## ######## ##    ## ########  ########    ###     ######  ########\n' +
  '##       ##     ##   ## ##   ###   ## ##   ##  ##       ###   ## ##     ## ##         ## ##   ##    ##    ##\n' +
  '##       ##     ##  ##   ##  ####  ## ##  ##   ##       ####  ## ##     ## ##        ##   ##  ##          ##\n' +
  '######   ########  ##     ## ## ## ## #####    ######   ## ## ## ########  ######   ##     ##  ######     ##\n' +
  '##       ##   ##   ######### ##  #### ##  ##   ##       ##  #### ##     ## ##       #########       ##    ##\n' +
  '##       ##    ##  ##     ## ##   ### ##   ##  ##       ##   ### ##     ## ##       ##     ## ##    ##    ##\n' +
  '##       ##     ## ##     ## ##    ## ##    ## ######## ##    ## ########  ######## ##     ##  ######     ##\n' +
  `${A.reset}\n`;

// ── Service highlighting ──

function highlightServices(msg: string): string {
  return msg
    .replace(/\[claude\]/g, `${A.magenta}${A.bold}[claude]${A.reset}${A.gray}`)
    .replace(/\[codex\]/g, `${A.blue}${A.bold}[codex]${A.reset}${A.gray}`)
    .replace(/(→\s*\w+:)/g, `${A.cyan}$1${A.reset}${A.gray}`)
    .replace(/(←\s*result:)/g, `${A.green}$1${A.reset}${A.gray}`)
    .replace(/(git\s+[^\s].*?)(?=$|\n)/g, `${A.green}$1${A.reset}${A.gray}`);
}

// ── BeastLogger class ──

export interface BeastLoggerOptions {
  readonly verbose: boolean;
  readonly captureForFile?: boolean;
}

export class BeastLogger implements ILogger {
  private readonly verbose: boolean;
  private readonly captureForFile: boolean;
  private readonly entries: string[] = [];

  constructor(options: BeastLoggerOptions) {
    this.verbose = options.verbose;
    this.captureForFile = options.captureForFile ?? false;
  }

  info(msg: string, _data?: unknown): void {
    const ts = this.timestamp();
    console.log(`${ts} ${A.cyan}${A.bold} INFO${A.reset} ${msg}`);
    this.capture('INFO', msg);
  }

  debug(msg: string, _data?: unknown): void {
    if (!this.verbose) return;
    const ts = this.timestamp();
    const highlighted = highlightServices(msg);
    console.log(`${ts} ${A.gray}DEBUG ${highlighted}${A.reset}`);
    this.capture('DEBUG', msg);
  }

  warn(msg: string, _data?: unknown): void {
    const ts = this.timestamp();
    console.log(`${ts} ${A.yellow}${A.bold} WARN${A.reset} ${A.yellow}${msg}${A.reset}`);
    this.capture('WARN', msg);
  }

  error(msg: string, _data?: unknown): void {
    const ts = this.timestamp();
    console.log(`${ts} ${A.red}${A.bold}ERROR${A.reset} ${A.red}${msg}${A.reset}`);
    this.capture('ERROR', msg);
  }

  /** Get captured log entries for writing to a plain-text log file. */
  getLogEntries(): string[] {
    return [...this.entries];
  }

  private timestamp(): string {
    return `${A.gray}${new Date().toTimeString().slice(0, 8)}${A.reset}`;
  }

  private capture(level: string, msg: string): void {
    if (!this.captureForFile) return;
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 8);
    this.entries.push(`[${date} ${time}] [${level}] ${stripAnsi(msg)}`);
  }
}

export { A as ANSI };
