import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Runs the real CLI against a results dir holding one test whose attachments
// are `attachments`, and returns the published attachment files plus the
// attachment entries written to latest.json.
async function runWithAttachments(attachments, setup = async () => {}) {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'allure-dash-sec-'));
  const results = path.join(ws, 'results');
  const out = path.join(ws, 'out');
  await fs.mkdir(results);
  await setup(ws, results);
  await fs.writeFile(
    path.join(results, 'a-result.json'),
    JSON.stringify({ uuid: 'a', historyId: 'h', name: 't', fullName: 't', status: 'failed', attachments }),
  );
  execFileSync('node', [path.join(repo, 'src/process.mjs'), '--results', results, '--output', out, '--run-id', 'r1'], {
    env: { ...process.env, GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' },
  });
  const dir = path.join(out, 'data', 'attachments', 'r1');
  const files = await fs.readdir(dir).catch(() => []);
  const latest = JSON.parse(await fs.readFile(path.join(out, 'data', 'latest.json'), 'utf8'));
  return { ws, dir, files, atts: latest.tests[0].attachments };
}

test('attachment sources that escape the results dir are never published', async () => {
  const { files, atts } = await runWithAttachments(
    [
      { name: 'traversal', type: 'text/plain', source: '../secret.txt' },
      { name: 'absolute', type: 'text/plain', source: '/etc/hosts' },
      { name: 'nested', type: 'text/plain', source: 'sub/../../secret.txt' },
      { name: 'symlink', type: 'text/plain', source: 'link-attachment.txt' },
    ],
    async (ws, results) => {
      await fs.writeFile(path.join(ws, 'secret.txt'), 'TOKEN');
      await fs.symlink(path.join(ws, 'secret.txt'), path.join(results, 'link-attachment.txt'));
    },
  );
  assert.deepEqual(files, []);
  assert.ok(atts.every((a) => !a.path), 'each is reported as missing, with no path');
});

test('a plain attachment inside the results dir is still published', async () => {
  const { files, atts } = await runWithAttachments(
    [{ name: 'shot', type: 'image/png', source: 'x-attachment.png' }],
    (ws, results) => fs.writeFile(path.join(results, 'x-attachment.png'), 'png'),
  );
  assert.deepEqual(files, ['x-attachment.png']);
  assert.equal(atts[0].path, './data/attachments/r1/x-attachment.png');
  assert.equal(atts[0].type, 'image/png');
});

test('HTML and SVG attachments are published as plain text, not as documents', async () => {
  const { files, atts } = await runWithAttachments(
    [
      { name: 'page source', type: 'text/html', source: 'p-attachment.html' },
      { name: 'diagram', type: 'image/svg+xml', source: 'd-attachment.svg' },
      { name: 'mislabelled', type: 'text/plain', source: 'm-attachment.htm' },
    ],
    async (ws, results) => {
      for (const f of ['p-attachment.html', 'd-attachment.svg', 'm-attachment.htm']) {
        await fs.writeFile(path.join(results, f), '<script>alert(1)</script>');
      }
    },
  );
  assert.deepEqual(files.sort(), ['d-attachment.svg.txt', 'm-attachment.htm.txt', 'p-attachment.html.txt']);
  assert.ok(atts.every((a) => a.type === 'text/plain' && a.path.endsWith('.txt')));
});

test('action inputs never get spliced into a run script as ${{ }} text', async () => {
  for (const file of ['action.yml', 'traceability/action.yml']) {
    const yml = await fs.readFile(path.join(repo, file), 'utf8');
    const script = yml.split(/^\s+run: \|\n/m)[1];
    assert.ok(script, `${file} has a run script`);
    assert.doesNotMatch(script, /\$\{\{/, `${file}: pass values through env: instead`);
  }
});

test('an output-path with a line break is rejected before any step output is written', async () => {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'allure-dash-sec-'));
  const results = path.join(ws, 'results');
  await fs.mkdir(results);
  const outputs = path.join(ws, 'github-output');
  await fs.writeFile(outputs, '');
  const clis = [
    ['src/process.mjs'],
    ['traceability/src/process.mjs', '--requirement-annotation', 'requirement'],
  ];
  for (const [cli, ...extra] of clis) {
    assert.throws(
      () => execFileSync('node', [path.join(repo, cli), '--results', results, '--output', `${ws}/out\ninjected=1`, ...extra], {
        env: { ...process.env, GITHUB_OUTPUT: outputs, GITHUB_STEP_SUMMARY: '' },
        stdio: 'pipe',
      }),
      /line breaks/,
      cli,
    );
  }
  assert.equal(await fs.readFile(outputs, 'utf8'), '');
});
