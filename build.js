/**
 * build.js — Obfuscates extension JS files and copies everything to dist/
 */
const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const SRC = path.join(__dirname, 'extension');
const DIST = path.join(__dirname, 'dist');

// Obfuscation config — maximum protection while keeping MV3 service worker compatible
const OBF_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 1,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 1,
  debugProtection: false,            // breaks in service worker context
  disableConsoleOutput: false,       // need console for debugging
  identifierNamesGenerator: 'mangled-shuffled',
  numbersToExpressions: true,
  renameGlobals: false,              // keep chrome.* APIs intact
  selfDefending: false,              // breaks in strict-mode service workers
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 3,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 1,
  stringArrayEncoding: ['rc4'],      // rc4 is much harder to reverse than base64
  stringArrayIndexesType: ['hexadecimal-number', 'hexadecimal-numeric-string'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 3,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 5,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 1,
  transformObjectKeys: true,
  unicodeEscapeSequence: true,
  reservedNames: [
    'extractContentFromFrame',
    'extractContentFromWrapperFrame',
    'extractMarkdownFromFrame',
    'performAutoScroll',
  ],
  target: 'browser',
};

// Files to obfuscate
const JS_FILES = ['background.js', 'popup.js', 'print.js'];

// Files/dirs to copy as-is
const COPY_FILES = ['manifest.json', 'popup.html', 'print.html', 'injected.js'];
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
