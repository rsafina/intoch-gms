const fs = require('node:fs');
const path = require('node:path');

function buildWorker(outputDir = path.join(__dirname, 'generated')) {
  const root = path.resolve(__dirname, '../..');
  const source = fs.readFileSync(path.join(root, 'access-expired.html'), 'utf8');
  const logoReference = 'src="assets/intoch-logo.png"';
  if (source.split(logoReference).length !== 2) {
    throw new Error('Expected exactly one Intoch logo reference in the expiration page.');
  }
  const logo = fs.readFileSync(path.join(root, 'assets/intoch-logo.png')).toString('base64');
  const html = source.replace(logoReference, `src="data:image/png;base64,${logo}"`);
  const handler = fs.readFileSync(path.join(__dirname, 'handler.mjs'), 'utf8');
  fs.mkdirSync(outputDir, { recursive: true });
  const workerPath = path.join(outputDir, 'worker.mjs');
  fs.writeFileSync(workerPath, `${handler}\nexport default createWorker(${JSON.stringify(html)});\n`);
  return workerPath;
}

module.exports = { buildWorker };
if (require.main === module) console.log(buildWorker());
