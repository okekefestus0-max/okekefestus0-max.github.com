// Copies the pdf.js worker into /public so it can be served locally
// (avoids CDN dependency for offline/PWA usage).
const fs = require('fs');
const path = require('path');

const src = require.resolve('pdfjs-dist/build/pdf.worker.min.js');
const destDir = path.join(__dirname, '..', 'public');
const dest = path.join(destDir, 'pdf.worker.min.js');

if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('[postinstall] pdf.worker.min.js copied to public/');
