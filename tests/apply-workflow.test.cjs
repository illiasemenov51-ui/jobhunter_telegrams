const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const workflow = JSON.parse(fs.readFileSync(path.join(root, 'workflows/handle-apply.json'), 'utf8'));
const nodes = new Map(workflow.nodes.map(node => [node.name, node]));
const tailoringPrompt = nodes.get('Prepare CV tailoring request').parameters.jsCode;

test('CV tailoring reads and applies the optional user preference values', () => {
  const readPreferences = nodes.get('Read user preferences');
  const prepare = nodes.get('Prepare CV tailoring request');
  assert.equal(readPreferences.parameters.sheetName.value, 'config');
  assert.equal(readPreferences.parameters.operation, 'read');
  assert.equal(readPreferences.alwaysOutputData, true);
  assert.equal(prepare.parameters.mode, 'runOnceForAllItems');
  assert.equal(workflow.connections['Read user preferences'].main[1][0].node, 'Report apply error');

  const context = {
    base_cv_text: 'Python, PostgreSQL',
    vacancy: {title: 'Backend developer'},
    raw_vacancy_text: 'Python role'
  };
  const rows = [
    {key: 'preferred_keywords', value: 'Python, PostgreSQL'},
    {key: 'excluded_keywords', value: 'on-call; legacy'},
    {key: 'languages', value: 'English\nPolish'},
    {key: 'seniority', value: 'Senior'}
  ];
  const run = new Function('$input', '$', prepare.parameters.jsCode);
  const result = run({all: () => rows.map(json => ({json}))}, () => ({first: () => ({json: context})}))[0].json;
  const userContent = JSON.parse(result.user_content);

  assert.deepEqual(userContent.user_preferences, {
    preferred_keywords: ['Python', 'PostgreSQL'],
    excluded_keywords: ['on-call', 'legacy'],
    languages: ['English', 'Polish'],
    seniority: ['Senior']
  });
  assert.equal(userContent.base_cv, context.base_cv_text);
  assert.ok(result.system_prompt.includes('Never invent employers, dates, skills, certificates, or metrics'));
  assert.ok(result.system_prompt.includes('De-emphasize excluded keywords'));
});

test('tailoring prompt contains the required factuality and output constraints', () => {
  for (const phrase of [
    'untrusted data',
    'Never invent employers, dates, skills, certificates, or metrics',
    'Only reorder, rephrase, shorten, and emphasize facts',
    'gaps array',
    'one page',
    'ATS-friendly HTML with inline CSS',
    'do not use images or tables for layout'
  ]) {
    assert.ok(tailoringPrompt.includes(phrase), `missing prompt constraint: ${phrase}`);
  }
});

test('CV sources include local markdown and Google Drive PDF extraction', () => {
  assert.equal(nodes.get('Read base CV file').parameters.fileSelector, '/data/cv_base.md');
  assert.equal(nodes.get('Extract CV text file').parameters.operation, 'text');
  assert.equal(nodes.get('Download base CV from Drive').parameters.operation, 'download');
  assert.equal(nodes.get('Extract CV text from PDF').parameters.operation, 'pdf');
});

test('Gotenberg receives index.html as multipart files and returns a PDF binary', () => {
  const htmlFile = nodes.get('Make Gotenberg HTML file');
  const convert = nodes.get('Convert CV to PDF');
  assert.equal(htmlFile.parameters.options.fileName, 'index.html');
  assert.equal(convert.parameters.url, 'http://gotenberg:3000/forms/chromium/convert/html');
  assert.equal(convert.parameters.bodyParameters.parameters[0].name, 'files');
  assert.equal(convert.parameters.bodyParameters.parameters[0].inputDataFieldName, 'data');
  assert.equal(convert.parameters.options.response.response.responseFormat, 'file');
});

test('workflow creates a Gmail draft only and never sends an email', () => {
  const gmailNodes = workflow.nodes.filter(node => node.type === 'n8n-nodes-base.gmail');
  assert.deepEqual(gmailNodes.map(node => [node.parameters.resource, node.parameters.operation]), [['draft', 'create']]);
});
