/**
 * build.js — Obfuscates extension JS files and copies everything to dist/
 */
const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const SRC = path.join(__dirname, 'extension');
const DIST = path.join(__dirname, 'dist');

// Obfuscation config — medium protection, keeps it functional in MV3 service worker
const OBF_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.6,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.3,
  debugProtection: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,           // keep chrome.* APIs intact
  selfDefending: false,           // breaks in strict-mode service workers
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.7,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
  target: 'browser',
};

// Files to obfuscate
const JS_FILES = ['background.js', 'popup.js', 'print.js'];

// Files/dirs to copy as-is
const COPY_FILES = ['manifest.json', 'popup.html', 'print.html'];
const COPY_DIRS = ['icons'];

// ── Clean & create dist ────────────────────────────────────
if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true });
}
fs.mkdirSync(DIST, { recursive: true });

// ── Obfuscate JS files ────────────────────────────────────
for (const file of JS_FILES) {
  const srcPath = path.join(SRC, file);
  if (!fs.existsSync(srcPath)) {
    console.warn(`⚠ Skipping ${file} (not found)`);
    continue;
  }
  const code = fs.readFileSync(srcPath, 'utf-8');
  console.log(`🔒 Obfuscating ${file} (${code.length} chars)…`);
  
  const result = JavaScriptObfuscator.obfuscate(code, OBF_OPTIONS);
  const obfuscated = result.getObfuscatedCode();
  
  fs.writeFileSync(path.join(DIST, file), obfuscated, 'utf-8');
  console.log(`   → ${obfuscated.length} chars (${((obfuscated.length / code.length) * 100).toFixed(0)}% of original)`);
}

// ── Copy static files ──────────────────────────────────────
for (const file of COPY_FILES) {
  const srcPath = path.join(SRC, file);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, path.join(DIST, file));
    console.log(`📄 Copied ${file}`);
  }
}

for (const dir of COPY_DIRS) {
  const srcDir = path.join(SRC, dir);
  const distDir = path.join(DIST, dir);
  if (fs.existsSync(srcDir)) {
    fs.mkdirSync(distDir, { recursive: true });
    for (const f of fs.readdirSync(srcDir)) {
      fs.copyFileSync(path.join(srcDir, f), path.join(distDir, f));
    }
    console.log(`📁 Copied ${dir}/ (${fs.readdirSync(srcDir).length} files)`);
  }
}

console.log('\n✅ Build complete → dist/');
