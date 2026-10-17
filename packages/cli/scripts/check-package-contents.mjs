#!/usr/bin/env node
/**
 * Packs the public CLI, inspects its boundary, then exercises `pack list` and
 * `pack add` from the extracted tarball so starter assets cannot be omitted.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const FORBIDDEN_ENTRIES = [/planner/iu, /\bchat\b/iu, /session/iu, /input-router/iu, /intent/iu];
const REQUIRED_LEGAL_ENTRIES = ['package/LICENSE', 'package/NOTICE'];
const EXPECTED_PACKS = ['agent-trace', 'coding-agent', 'rag-answer-quality', 'support-bot'];

const stagingDirectory = await mkdtemp(join(tmpdir(), 'autoeval-pack-'));

function resolvePackCommand() {
  const packageManagerExecPath = process.env.npm_execpath;
  const packageManagerUserAgent = process.env.npm_config_user_agent ?? '';
  const isPnpm = /\bpnpm\//iu.test(packageManagerUserAgent);
  const packArgs = ['pack'];
  if (!isPnpm) packArgs.push('--ignore-scripts');

  if (packageManagerExecPath && packageManagerExecPath.length > 0) {
    return {
      command: process.execPath,
      args: [packageManagerExecPath, ...packArgs],
    };
  }

  return {
    command: 'npm',
    args: packArgs,
  };
}
try {
  const { command, args } = resolvePackCommand();
  const { stdout } = await execFileAsync(
    command,
    [...args, '--pack-destination', stagingDirectory],
    { cwd: packageRoot },
  );
  const tarballName = stdout.trim().split('\n').at(-1) ?? '';
  const tarball = isAbsolute(tarballName) ? tarballName : join(stagingDirectory, tarballName);
  const tarCommand = process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar';

  const listing = await execFileAsync(tarCommand, ['-tzf', tarball]);
  const entries = listing.stdout.split('\n').filter((entry) => entry.length > 0);

  const violations = entries
    .filter((entry) => FORBIDDEN_ENTRIES.some((pattern) => pattern.test(entry)))
    .map((entry) => `${entry}: closed-surface file`);

  for (const entry of REQUIRED_LEGAL_ENTRIES) {
    if (!entries.includes(entry)) {
      violations.push(`${entry}: required legal file is missing`);
      continue;
    }
    const contents = await execFileAsync(tarCommand, ['-xOzf', tarball, entry]);
    if (contents.stdout.trim().length === 0) {
      violations.push(`${entry}: required legal file is empty`);
    }
  }

  if (violations.length === 0) {
    const extractedDirectory = join(stagingDirectory, 'extracted');
    const installedPackage = join(extractedDirectory, 'package');
    const exerciseDirectory = join(stagingDirectory, 'exercise');
    await mkdir(extractedDirectory);
    await mkdir(exerciseDirectory);
    await execFileAsync(tarCommand, ['-xzf', tarball, '-C', extractedDirectory]);
    await symlink(
      join(packageRoot, 'node_modules'),
      join(installedPackage, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const cliEntry = join(installedPackage, 'dist', 'cli.js');
    const listed = await execFileAsync(process.execPath, [cliEntry, '--json', 'pack', 'list'], {
      cwd: exerciseDirectory,
    });
    const packNames = JSON.parse(listed.stdout)
      .map((pack) => pack.name)
      .sort();
    if (JSON.stringify(packNames) !== JSON.stringify(EXPECTED_PACKS)) {
      violations.push(
        `pack list: expected ${EXPECTED_PACKS.join(', ')}, got ${packNames.join(', ')}`,
      );
    }

    await execFileAsync(process.execPath, [cliEntry, 'pack', 'add', 'support-bot'], {
      cwd: exerciseDirectory,
    });
    const installedManifest = await readFile(
      join(exerciseDirectory, 'autoeval', 'support-bot', 'autoeval.suite.yaml'),
      'utf8',
    );
    const installedEval = await readFile(
      join(exerciseDirectory, 'autoeval', 'support-bot', 'evals', 'support-conversation.json'),
      'utf8',
    );
    if (!installedManifest.includes('evals/support-conversation.json')) {
      violations.push('pack add: installed manifest does not reference the bundled eval');
    }
    if (!installedEval.includes('Successful booking change')) {
      violations.push('pack add: installed eval does not match the bundled starter pack');
    }
  }

  if (violations.length > 0) {
    console.error('Public package contents are invalid:');
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exit(1);
  }
  console.log(`Public package contents verified (${entries.length} entries).`);
} finally {
  await rm(stagingDirectory, { recursive: true, force: true });
}
