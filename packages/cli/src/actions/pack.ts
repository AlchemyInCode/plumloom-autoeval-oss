import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { stringify as stringifyYaml } from 'yaml';

import type { EvaluationContextType } from '../domain/types.js';
import { AutoevalError } from '../errors/autoeval-error.js';
import type { BundledPack } from '../packs/registry.js';
import { parseSuiteManifest, type SuiteManifest } from '../suite/manifest.js';

/** Pack installation planning and integrity-checked filesystem operations. */
export type PackFileToWrite = {
  absolutePath: string;
  contents: string;
};

export type PackInstallPlan = {
  packName: string;
  context: EvaluationContextType;
  /** Absolute root selected by the caller, containing the per-pack directory. */
  targetDirectory: string;
  /** Absolute `<targetDirectory>/<packName>` directory the pack installs into. */
  installDirectory: string;
  /** Absolute path of the generated suite manifest. */
  manifestPath: string;
  /** Pack files plus the generated manifest, in write order. */
  files: readonly PackFileToWrite[];
  /** Absolute eval file paths referenced by the manifest, in manifest order. */
  evalFileAbsolutePaths: readonly string[];
};

const MANIFEST_FILENAME = 'autoeval.suite.yaml';

/**
 * Synthetic placeholder workspace used only when no default is known yet. It is
 * overridden at run time by `--workspace` or the resolved workspace, so a pack
 * installed before a default is saved still runs once a workspace is resolved.
 */
const SYNTHETIC_WORKSPACE_PLACEHOLDER = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

/** Scenario packs grade a model under test; other contexts need only a judge. */
export function packRequiresPrimaryModel(context: EvaluationContextType): boolean {
  return context === 'scenario';
}

/** A pack name must be a single, safe path segment (it becomes a directory). */
function assertSafePackName(name: string): void {
  if (name === '' || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    throw new AutoevalError(`Pack "${name}" has an unsafe name.`, {
      kind: 'validation',
      code: 'PACK_INVALID_PATH',
    });
  }
}

/**
 * Resolves a pack-declared relative path under the install directory and
 * confirms it does not escape it. Pack contents are treated as untrusted (a
 * `..` or absolute entry must never write outside the install directory), even
 * though the bundled packs are first-party today.
 */
function resolveContainedPath(installDirectory: string, relativePath: string): string {
  if (relativePath === '' || isAbsolute(relativePath)) {
    throw new AutoevalError(`Pack path "${relativePath}" must be a relative path.`, {
      kind: 'validation',
      code: 'PACK_INVALID_PATH',
    });
  }
  const absolutePath = resolve(installDirectory, relativePath);
  const rel = relative(installDirectory, absolutePath);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new AutoevalError(`Pack path "${relativePath}" escapes the install directory.`, {
      kind: 'validation',
      code: 'PACK_INVALID_PATH',
    });
  }
  return absolutePath;
}

export function planPackInstall(
  pack: BundledPack,
  targetDirectory: string,
  options: { workspaceId?: string } = {},
): PackInstallPlan {
  assertSafePackName(pack.name);
  const installDirectory = resolve(targetDirectory, pack.name);

  const files: PackFileToWrite[] = pack.files.map((file) => ({
    absolutePath: resolveContainedPath(installDirectory, file.relativePath),
    contents: file.contents,
  }));

  const manifestObject = {
    workspace: options.workspaceId ?? SYNTHETIC_WORKSPACE_PLACEHOLDER,
    ...(pack.gate === undefined ? {} : { gate: pack.gate }),
    evals: [...pack.evals],
  };
  const manifestPath = resolveContainedPath(installDirectory, MANIFEST_FILENAME);
  files.push({ absolutePath: manifestPath, contents: stringifyYaml(manifestObject) });

  return {
    packName: pack.name,
    context: pack.context,
    targetDirectory: resolve(targetDirectory),
    installDirectory,
    manifestPath,
    files,
    evalFileAbsolutePaths: pack.evals.map((evalPath) =>
      resolveContainedPath(installDirectory, evalPath),
    ),
  };
}

export type PackInstallResult = {
  status: 'installed' | 'already-installed';
  manifest: SuiteManifest;
};

type ExistingFile = { file: PackFileToWrite; contents: string };

function fileDisplayPath(plan: PackInstallPlan, absolutePath: string): string {
  return relative(plan.targetDirectory, absolutePath) || '.';
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

async function assertNoSymlinkComponents(plan: PackInstallPlan): Promise<void> {
  let existingAncestor = plan.targetDirectory;
  while (true) {
    try {
      const metadata = await lstat(existingAncestor);
      if (metadata.isSymbolicLink()) {
        throw new AutoevalError('A pack directory cannot be a symbolic link.', {
          kind: 'validation',
          code: 'PACK_INVALID_PATH',
        });
      }
      if (!metadata.isDirectory()) {
        throw new AutoevalError('A pack path component must be a directory.', {
          kind: 'validation',
          code: 'PACK_INVALID_PATH',
        });
      }
      break;
    } catch (error) {
      if (error instanceof AutoevalError) throw error;
      if (errorCode(error) !== 'ENOENT') {
        throw new AutoevalError('A pack directory could not be inspected safely.', {
          kind: 'usage',
          code: 'PACK_WRITE_FAILED',
          cause: error,
        });
      }
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) break;
      existingAncestor = parent;
    }
  }

  const directories = new Set<string>([plan.targetDirectory, plan.installDirectory]);
  for (const file of plan.files) directories.add(dirname(file.absolutePath));

  for (const target of directories) {
    const rel = relative(plan.targetDirectory, target);
    const segments = rel === '' ? [] : rel.split(sep);
    let current = plan.targetDirectory;
    for (let index = -1; index < segments.length; index += 1) {
      if (index >= 0) current = resolve(current, segments[index] ?? '');
      try {
        const metadata = await lstat(current);
        if (metadata.isSymbolicLink()) {
          throw new AutoevalError('A pack directory cannot be a symbolic link.', {
            kind: 'validation',
            code: 'PACK_INVALID_PATH',
          });
        }
        if (!metadata.isDirectory()) {
          throw new AutoevalError('A pack path component must be a directory.', {
            kind: 'validation',
            code: 'PACK_INVALID_PATH',
          });
        }
      } catch (error) {
        if (error instanceof AutoevalError) throw error;
        if (errorCode(error) === 'ENOENT') break;
        throw new AutoevalError('A pack directory could not be inspected safely.', {
          kind: 'usage',
          code: 'PACK_WRITE_FAILED',
          cause: error,
        });
      }
    }
  }
}

async function readExistingFile(
  plan: PackInstallPlan,
  file: PackFileToWrite,
): Promise<ExistingFile | undefined> {
  try {
    const metadata = await lstat(file.absolutePath);
    if (metadata.isSymbolicLink()) {
      throw new AutoevalError(
        `Existing pack path ${fileDisplayPath(plan, file.absolutePath)} cannot be a symbolic link.`,
        { kind: 'validation', code: 'PACK_FILES_MODIFIED' },
      );
    }
    if (!metadata.isFile()) {
      throw new AutoevalError(
        `Existing pack path ${fileDisplayPath(plan, file.absolutePath)} is not a regular file.`,
        { kind: 'validation', code: 'PACK_FILES_MODIFIED' },
      );
    }
    const expectedBytes = Buffer.byteLength(file.contents, 'utf8');
    if (metadata.size !== expectedBytes && file.absolutePath !== plan.manifestPath) {
      return { file, contents: '' };
    }
    const contents = await readFile(file.absolutePath, 'utf8');
    return { file, contents };
  } catch (error) {
    if (error instanceof AutoevalError) throw error;
    if (errorCode(error) === 'ENOENT') return undefined;
    throw new AutoevalError(
      `Existing pack path ${fileDisplayPath(plan, file.absolutePath)} could not be inspected.`,
      { kind: 'usage', code: 'PACK_WRITE_FAILED', cause: error },
    );
  }
}

async function writePlanTransactionally(plan: PackInstallPlan): Promise<void> {
  const createdFiles: string[] = [];
  const createdDirectories: string[] = [];
  const rollback = async (): Promise<void> => {
    for (const filePath of createdFiles.reverse()) {
      await rm(filePath, { force: true }).catch(() => undefined);
    }
    for (const directoryPath of createdDirectories.reverse()) {
      await rm(directoryPath, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  try {
    for (const file of plan.files) {
      const firstCreatedDirectory = await mkdir(dirname(file.absolutePath), { recursive: true });
      if (firstCreatedDirectory !== undefined) createdDirectories.push(firstCreatedDirectory);
      try {
        await writeFile(file.absolutePath, file.contents, { encoding: 'utf8', flag: 'wx' });
        createdFiles.push(file.absolutePath);
      } catch (error) {
        if (errorCode(error) === 'EEXIST') {
          throw new AutoevalError(
            `A pack file already exists at ${fileDisplayPath(plan, file.absolutePath)}. Remove it or choose a different --dir.`,
            { kind: 'usage', code: 'PACK_FILE_EXISTS', cause: error },
          );
        }
        throw new AutoevalError(
          `A pack file could not be written at ${fileDisplayPath(plan, file.absolutePath)}.`,
          { kind: 'usage', code: 'PACK_WRITE_FAILED', cause: error },
        );
      }
    }
  } catch (error) {
    await rollback();
    throw error;
  }
}

function expectedManifest(plan: PackInstallPlan): SuiteManifest {
  const manifestFile = plan.files.find((file) => file.absolutePath === plan.manifestPath);
  if (manifestFile === undefined) {
    throw new AutoevalError('The bundled pack does not contain its suite manifest.', {
      kind: 'validation',
      code: 'PACK_INVALID_PATH',
    });
  }
  return parseSuiteManifest(manifestFile.contents, plan.manifestPath);
}

function assertTrustedExistingPack(
  plan: PackInstallPlan,
  existingFiles: readonly ExistingFile[],
): SuiteManifest {
  for (const existing of existingFiles) {
    if (existing.file.absolutePath === plan.manifestPath) continue;
    if (existing.contents !== existing.file.contents) {
      throw new AutoevalError(
        `Pack file ${fileDisplayPath(plan, existing.file.absolutePath)} differs from the bundled pack. Run it explicitly with "autoeval suite run --manifest ${fileDisplayPath(plan, plan.manifestPath)}" or remove the pack directory and reinstall it.`,
        { kind: 'validation', code: 'PACK_FILES_MODIFIED' },
      );
    }
  }

  const actualSource = existingFiles.find(
    (existing) => existing.file.absolutePath === plan.manifestPath,
  )?.contents;
  if (actualSource === undefined) {
    throw new AutoevalError('The installed pack is missing its suite manifest.', {
      kind: 'validation',
      code: 'PACK_FILES_MODIFIED',
    });
  }
  const actual = parseSuiteManifest(actualSource, plan.manifestPath);
  const expected = expectedManifest(plan);
  const sameFiles = isDeepStrictEqual(actual.evalFiles, expected.evalFiles);
  const samePolicies = isDeepStrictEqual(
    actual.entries.map((entry) => entry.gate),
    expected.entries.map((entry) => entry.gate),
  );
  if (!sameFiles || !samePolicies) {
    throw new AutoevalError(
      `Pack manifest ${fileDisplayPath(plan, plan.manifestPath)} differs from the bundled pack. Run the adapted manifest with "autoeval suite run --manifest ${fileDisplayPath(plan, plan.manifestPath)}" or remove the pack directory and reinstall it.`,
      { kind: 'validation', code: 'PACK_FILES_MODIFIED' },
    );
  }
  return actual;
}

/** Installs a fresh pack and refuses every pre-existing pack file. */
export async function installPack(plan: PackInstallPlan): Promise<void> {
  await assertNoSymlinkComponents(plan);
  const existing = await Promise.all(plan.files.map((file) => readExistingFile(plan, file)));
  const collision = existing.find((entry) => entry !== undefined);
  if (collision !== undefined) {
    throw new AutoevalError(
      `A pack file already exists at ${fileDisplayPath(plan, collision.file.absolutePath)}. Remove it or choose a different --dir.`,
      { kind: 'usage', code: 'PACK_FILE_EXISTS' },
    );
  }
  await writePlanTransactionally(plan);
}

/** Installs a missing pack, or reuses it only when every existing file is trusted. */
export async function ensurePackInstalled(plan: PackInstallPlan): Promise<PackInstallResult> {
  await assertNoSymlinkComponents(plan);
  const inspected = await Promise.all(plan.files.map((file) => readExistingFile(plan, file)));
  const existing = inspected.filter((entry): entry is ExistingFile => entry !== undefined);
  if (existing.length === 0) {
    await writePlanTransactionally(plan);
    return { status: 'installed', manifest: expectedManifest(plan) };
  }
  if (existing.length !== plan.files.length) {
    throw new AutoevalError(
      'The pack directory contains only part of the bundled pack. Remove the directory and reinstall it.',
      { kind: 'validation', code: 'PACK_FILES_MODIFIED' },
    );
  }
  return { status: 'already-installed', manifest: assertTrustedExistingPack(plan, existing) };
}
