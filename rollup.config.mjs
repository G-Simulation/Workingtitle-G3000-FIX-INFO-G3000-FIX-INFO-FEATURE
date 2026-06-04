import css from 'rollup-plugin-import-css';
import resolve from '@rollup/plugin-node-resolve';
import { spawn } from 'node:child_process';

const OUT_DIR = 'package/g3000-fix-info-feature-2024/html_ui/G3000FixMod';

/** Regenerates layout.json after a bundle is written. Used to keep watch-mode in sync. */
const layoutPlugin = {
  name: 'fixinfo-layout',
  writeBundle() {
    const child = spawn('node', ['scripts/generate-layout.mjs'], { stdio: 'inherit', shell: false });
    child.on('error', (err) => { console.error('[layout] failed to spawn', err); });
  },
};

const EXTERNAL = [
  '@microsoft/msfs-sdk',
  '@microsoft/msfs-garminsdk',
  '@microsoft/msfs-wtg3000-common',
  '@microsoft/msfs-wtg3000-gtc',
  '@microsoft/msfs-wtg3000-mfd',
  '@microsoft/msfs-wtg3000-pfd',
];

const GLOBALS = {
  '@microsoft/msfs-sdk': 'msfssdk',
  '@microsoft/msfs-garminsdk': 'garminsdk',
  '@microsoft/msfs-wtg3000-common': 'wtg3000common',
  '@microsoft/msfs-wtg3000-gtc': 'wtg3000gtc',
  '@microsoft/msfs-wtg3000-mfd': 'wtg3000mfd',
  '@microsoft/msfs-wtg3000-pfd': 'wtg3000pfd',
};

const PLUGINS = [
  css({ output: 'G3000FixPlugin.css' }),
  resolve(),
  layoutPlugin,
];

export default [
  {
    input: 'build/html_ui/gtc/index.js',
    output: {
      file: `${OUT_DIR}/G3000FixGtcPlugin.js`,
      format: 'iife',
      name: 'g3000FixInfoFixGtc',
      globals: GLOBALS,
    },
    external: EXTERNAL,
    plugins: PLUGINS,
  },
  {
    input: 'build/html_ui/mfd/index.js',
    output: {
      file: `${OUT_DIR}/G3000FixMfdPlugin.js`,
      format: 'iife',
      name: 'g3000FixInfoFixMfd',
      globals: GLOBALS,
    },
    external: EXTERNAL,
    plugins: PLUGINS,
  },
  // PFD bundle temporarily disabled — caused mod-load failure on aircraft.
  // The wtg3000pfd runtime global may not exist in MSFS 2024, or the
  // NavInsetMap subclass construction throws. Needs investigation before
  // re-enabling.
];
