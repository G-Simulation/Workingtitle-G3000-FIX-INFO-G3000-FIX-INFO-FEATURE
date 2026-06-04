/**
 * A small per-instrument dev panel mounted top-left of the Coherent root document.
 * Provides:
 * - a reload button (calls location.reload() on the current Coherent context)
 * - a multi-line status display refreshed by the owning plugin
 * - a captured console.log/error stream
 * - an optional JS eval input
 *
 * Persists across plugin reloads via document.getElementById lookup.
 */

import { debugEnabled } from './Config';

const PANEL_ID = 'fix-info-dev-panel';
const LOG_LIMIT = 200;

export interface DevPanelOptions {
  /** Title shown at the top of the panel. */
  title: string;
  /** Background color of the title bar (e.g. '#c00' or '#06c'). */
  accent: string;
  /**
   * Optional hook fired when the user presses the panel's reload button.
   * Called BEFORE this panel's own `location.reload()`. Use this to publish a
   * cross-instrument reload event so other Coherent contexts reload too.
   * Return true to suppress the default reload (e.g. let the publisher do it).
   */
  onReload?: () => boolean | void;
}

export class DevPanel {
  private readonly root: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly statusEl: HTMLPreElement;
  private readonly logEl: HTMLDivElement;
  private readonly evalInput: HTMLInputElement;
  private readonly logs: { level: string; msg: string }[] = [];
  private collapsed = false;
  private logCaptureInstalled = false;

  constructor(opts: DevPanelOptions) {
    const existing = document.getElementById(PANEL_ID) as HTMLDivElement | null;
    if (existing) {
      this.root = existing;
      this.titleEl = existing.querySelector('.pfd-title') as HTMLDivElement;
      this.statusEl = existing.querySelector('.pfd-status') as HTMLPreElement;
      this.logEl = existing.querySelector('.pfd-log') as HTMLDivElement;
      this.evalInput = existing.querySelector('.pfd-eval') as HTMLInputElement;
      this.titleEl.textContent = opts.title;
      this.titleEl.style.background = opts.accent;
      // Re-apply the debug toggle to the existing panel (it may have been
      // created in a previous plugin lifecycle when debug was on).
      this.applyDebugVisibility(debugEnabled.get());
      debugEnabled.sub((v) => { this.applyDebugVisibility(v); });
      return;
    }

    this.root = document.createElement('div');
    this.root.id = PANEL_ID;
    this.root.style.cssText =
      'position:fixed;top:4px;left:4px;width:280px;z-index:2147483647;' +
      'background:rgba(0,0,0,0.85);color:#0f0;font:11px monospace;' +
      'border:1px solid #444;border-radius:4px;box-shadow:0 0 6px rgba(0,0,0,0.7);' +
      'display:flex;flex-direction:column;max-height:80vh;overflow:hidden;' +
      'pointer-events:none;';

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'pfd-title';
    this.titleEl.textContent = opts.title;
    this.titleEl.style.cssText =
      `background:${opts.accent};color:#fff;padding:3px 6px;font-weight:bold;` +
      'font-size:11px;cursor:pointer;user-select:none;display:flex;justify-content:space-between;' +
      'pointer-events:auto;';
    const titleText = document.createElement('span');
    titleText.textContent = opts.title;
    const titleBtns = document.createElement('span');
    titleBtns.style.cssText = 'display:flex;gap:4px;';
    const collapseBtn = this.makeTitleButton('-', () => this.toggleCollapsed());
    const reloadBtn = this.makeTitleButton('R', () => {
      const suppressed = opts.onReload ? opts.onReload() === true : false;
      if (!suppressed) location.reload();
    });
    titleBtns.appendChild(collapseBtn);
    titleBtns.appendChild(reloadBtn);
    this.titleEl.textContent = '';
    this.titleEl.appendChild(titleText);
    this.titleEl.appendChild(titleBtns);

    this.statusEl = document.createElement('pre');
    this.statusEl.className = 'pfd-status';
    this.statusEl.style.cssText =
      'margin:0;padding:4px 6px;font:11px monospace;color:#cfc;white-space:pre;' +
      'border-bottom:1px solid #333;line-height:1.3;';

    this.logEl = document.createElement('div');
    this.logEl.className = 'pfd-log';
    this.logEl.style.cssText =
      'flex:1 1 auto;overflow-y:auto;padding:4px 6px;font:10px monospace;' +
      'color:#aaa;max-height:240px;min-height:60px;';

    this.evalInput = document.createElement('input');
    this.evalInput.className = 'pfd-eval';
    this.evalInput.type = 'text';
    this.evalInput.placeholder = 'JS… (Enter to run)';
    this.evalInput.style.cssText =
      'border:0;border-top:1px solid #333;background:#111;color:#0f0;' +
      'padding:4px 6px;font:10px monospace;outline:none;pointer-events:auto;';
    this.evalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const code = this.evalInput.value;
        this.evalInput.value = '';
        this.runEval(code);
      }
    });

    this.root.appendChild(this.titleEl);
    this.root.appendChild(this.statusEl);
    this.root.appendChild(this.logEl);
    this.root.appendChild(this.evalInput);
    document.body.appendChild(this.root);

    // Apply the global debug toggle. Subscribe to changes for live on/off.
    this.applyDebugVisibility(debugEnabled.get());
    debugEnabled.sub((v) => { this.applyDebugVisibility(v); });

    this.installLogCapture();
  }

  private applyDebugVisibility(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  public setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  public log(level: 'log' | 'warn' | 'error', msg: string): void {
    this.logs.push({ level, msg });
    if (this.logs.length > LOG_LIMIT) this.logs.shift();
    const line = document.createElement('div');
    line.textContent = msg;
    line.style.color = level === 'error' ? '#f88' : level === 'warn' ? '#fc6' : '#aaa';
    this.logEl.appendChild(line);
    while (this.logEl.childNodes.length > LOG_LIMIT) {
      this.logEl.removeChild(this.logEl.firstChild!);
    }
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private makeTitleButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'background:rgba(255,255,255,0.2);color:#fff;border:0;padding:0 6px;' +
      'border-radius:2px;font:bold 11px monospace;cursor:pointer;';
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  private toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
    this.statusEl.style.display = this.collapsed ? 'none' : '';
    this.logEl.style.display = this.collapsed ? 'none' : '';
    this.evalInput.style.display = this.collapsed ? 'none' : '';
  }

  private runEval(code: string): void {
    this.log('log', `> ${code}`);
    try {
      // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
      const result = new Function(`return (${code})`)();
      this.log('log', `= ${formatResult(result)}`);
    } catch (err) {
      this.log('error', `! ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private installLogCapture(): void {
    if (this.logCaptureInstalled) return;
    this.logCaptureInstalled = true;
    const orig = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    };
    const intercept = (level: 'log' | 'warn' | 'error') => (...args: unknown[]) => {
      orig[level](...args);
      try { this.log(level, args.map(formatArg).join(' ')); } catch { /* ignore */ }
    };
    console.log = intercept('log');
    console.warn = intercept('warn');
    console.error = intercept('error');
  }
}

function formatArg(a: unknown): string {
  if (typeof a === 'string') return a;
  try { return JSON.stringify(a); } catch { return String(a); }
}

function formatResult(r: unknown): string {
  if (r === undefined) return 'undefined';
  if (r === null) return 'null';
  if (typeof r === 'function') return '[function]';
  if (typeof r === 'object') {
    try { return JSON.stringify(r, null, 2); } catch { return String(r); }
  }
  return String(r);
}
