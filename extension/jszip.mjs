// JSZip ESM Wrapper for Chrome Extension MV3
// Dynamically loads the UMD build and exports JSZip as default

let JSZip = null;

// Fetch and execute the UMD code, capturing the JSZip constructor
const response = await fetch(chrome.runtime.getURL('jszip-umd.js'));
const code = await response.text();

// Wrap the UMD code to work in ES module context
// The UMD pattern checks for: module.exports, define (AMD), or sets this.JSZip
const wrappedCode = `
  var global = globalThis;
  var window = globalThis;
  var self = globalThis;
  var module = { exports: {} };
  var exports = module.exports;
  var define = undefined;
  
  ${code}
  
  // UMD will have set module.exports to JSZip
  export default module.exports;
`;

const blob = new Blob([wrappedCode], { type: 'application/javascript' });
const blobUrl = URL.createObjectURL(blob);

try {
  const module = await import(blobUrl);
  JSZip = module.default;
} finally {
  URL.revokeObjectURL(blobUrl);
}

if (!JSZip || typeof JSZip !== 'function') {
  throw new Error('Failed to load JSZip constructor');
}

export default JSZip;
