// Builds the user-manual PDF from the in-app manual (public/index.html #manBody), so the PDF and the app never drift.
// Usage: cd /workspace/pwtest && node /workspace/medbilling-logs/scripts/make-manual-pdf.js [out.pdf]
const fs = require('fs'), path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: ['/workspace/pwtest'] }));
const PUB = path.join(__dirname, '..', 'public');
const OUT = process.argv[2] || '/workspace/medbilling-logs-user-manual.pdf';
const VERSION = process.env.MAN_VERSION || '9f';
(async () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  const m = html.match(/<div class="man" id="manBody">([\s\S]*?)<\/div>\s*<\/dialog>/); if (!m) throw new Error('manual not found');
  const body = m[1].replace(/<button[^>]*>[\s\S]*?<\/button>/g, '').replace(/<p class="manlead">[\s\S]*?<\/p>/, '');
  const css = fs.readFileSync(path.join(PUB, 'css', 'app.css'), 'utf8');
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>MedBilling Logs · User manual</title><style>${css}
    html,body{background:#fff!important;color:#111} body{font:10.5pt/1.45 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;margin:0}
    .man{max-width:none;padding:0} .man section{break-inside:auto;margin:0 0 10pt} .man h3{break-after:avoid;margin-top:14pt;color:#0f5f58}
    .man h4{break-after:avoid} .mantoc{columns:2;display:block} .mantoc a{display:block;color:#0f5f58;text-decoration:none;padding:1pt 0}
    .cover h1{margin:0;color:#0f5f58;font-size:22pt} .cover p{margin:4pt 0} .cover .sub{color:#555}
    @page{size:Letter;margin:16mm 15mm 16mm}</style></head><body>
    <div class="cover"><h1>MedBilling Logs</h1><p class="sub">User manual · version ${VERSION} · October 2026</p>
    <p class="sub">https://tp8p7c4vwr-del.github.io/medbilling-logs/ · Part of JFdeLara's Studio</p>
    <p>A private time and billing log for physicians. Everything stays on this device, encrypted with your passcode or passphrase. Every export is an AES-256 password-protected .zip. The same manual is built into the app (Settings → Help / User manual) and works offline.</p></div>
    <div class="man">${body}</div></body></html>`;
  const tmp = path.join(PUB, '__manual_print.html'); fs.writeFileSync(tmp, page);
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + tmp); await p.emulateMedia({ media: 'print' });
  await p.pdf({ path: OUT, format: 'Letter', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#666">MedBilling Logs · User manual v' + VERSION + ' · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>', margin: { top: '16mm', bottom: '16mm', left: '15mm', right: '15mm' } });
  await b.close(); fs.unlinkSync(tmp); console.log('wrote', OUT);
})().catch(e => { console.error(e); process.exit(1); });
