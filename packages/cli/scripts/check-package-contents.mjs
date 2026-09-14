#!/usr/bin/env node
/**
 * Packs the public CLI package and inspects the tarball listing so removed
 * interactive-session source cannot ship in the OSS distribution.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const FORBIDDEN_ENTRIES = [/planner/iu, /\bchat\b/iu, /session/iu, /input-router/iu, /intent/iu];
const REQUIRED_LEGAL_ENTRIES = ['package/LICENSE', 'package/NOTICE'];

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

  if (violations.length > 0) {
    console.error('Public package contents are invalid:');
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exit(1);
  }
  console.log(`Public package contents verified (${entries.length} entries).`);
} finally {
  await rm(stagingDirectory, { recursive: true, force: true });
}
