const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const workflow = JSON.parse(fs.readFileSync(path.join(root, 'workflows/send-next-card.json'), 'utf8'));
const cleaner = workflow.nodes.find(node => node.name === 'Pick and clean text').parameters.jsCode;
const clean = new Function('$json', cleaner);

for (const name of ['jsonld', 'plain', 'blocked']) {
  test(`cleans ${name} fixture`, () => {
    const html = fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.html`), 'utf8');
    const expected = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.expected.json`), 'utf8'));
    const result = clean({data: html})[0].json;

    assert.equal(Boolean(result.vacancy_text), expected.readable);
    for (const text of expected.contains) {
      assert.ok(result.vacancy_text.includes(text), `expected cleaned text to contain "${text}"`);
    }
    assert.ok(result.vacancy_text.length <= 12000);
  });
}
