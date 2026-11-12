const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Gotenberg converts an HTML file to PDF', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'cv_sample.html'));
  const form = new FormData();
  form.append('files', new Blob([html], {type: 'text/html'}), 'index.html');

  const response = await fetch('http://gotenberg:3000/forms/chromium/convert/html', {
    method: 'POST',
    body: form
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/pdf/);
  const pdf = Buffer.from(await response.arrayBuffer());
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});
