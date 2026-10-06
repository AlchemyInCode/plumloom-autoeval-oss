import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * Offline checks for the agent skill package at the repository root: one
 * canonical skill under `skills/`, plus the thin manifest each host reads.
 * Nothing here touches the network or a host application. The rules come from
 * the Agent Skills and Agent Plugins specifications and from each host's
 * documented required fields; see docs/public/integration-agent-skill.md.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const PLUGIN_SCHEMA_ID = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const MCP_SCHEMA_ID = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';

const SKILL_NAME = 'autoeval';
const SKILL_DIRECTORY = join('skills', SKILL_NAME);

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PACKAGE_NAME_PATTERN = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/u;
const SEMANTIC_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;
const SINGLE_EXECUTABLE_TOKEN_PATTERN = /^(?:\.\/)?[^\s/\\]+(?:\/[^\s/\\]+)*$/u;
const CREDENTIAL_LIKE_PATTERN = /pl_sk_[A-Za-z0-9_-]{4,}|\bsk-[A-Za-z0-9_-]{8,}|Bearer\s+\S{8,}/u;

const VERDICTS = ['PASS', 'FAIL', 'INCONCLUSIVE', 'ERROR'] as const;
const DESCRIPTION_TRIGGER_TERMS = ['evaluat', 'evals', 'release', 'gate', 'results', 'verdict'];
const GATE_COMMANDS = ['autoeval suite gate', 'autoeval gate'];

const skillFrontmatterSchema = z
  .object({
    name: z.string().min(1).max(64).regex(SKILL_NAME_PATTERN),
    description: z.string().min(1).max(1024),
    license: z.string().min(1).optional(),
    compatibility: z.string().min(1).max(500).optional(),
  })
  .strict();

const authorSchema = z
  .object({
    name: z.string().min(1),
    email: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
  })
  .strict();

const openAiInterfaceSchema = z.object({
  displayName: z.string().min(1).max(30),
  shortDescription: z.string().min(1).max(30),
  longDescription: z.string().min(1).max(4000),
  developerName: z.string().min(1).max(80),
  category: z.string().min(1),
  defaultPrompt: z.array(z.string().min(1).max(128)).max(3).optional(),
  composerIcon: z.string().startsWith('./'),
  logo: z.string().startsWith('./'),
});

/** Closed schema from Agent Plugins 1.0.0 section 5.2, with the fields Kiro requires. */
const agentPluginManifestSchema = z
  .object({
    $schema: z.literal(PLUGIN_SCHEMA_ID),
    name: z.string().min(1).max(64).regex(PACKAGE_NAME_PATTERN),
    version: z.string().regex(SEMANTIC_VERSION_PATTERN),
    description: z.string().min(1),
    author: authorSchema,
    homepage: z.string().min(1).optional(),
    repository: z.string().min(1).optional(),
    license: z.string().min(1),
    keywords: z.array(z.string().min(1)).min(1),
    extensions: z
      .object({ 'com.openai': z.object({ interface: openAiInterfaceSchema }) })
      .optional(),
  })
  .strict();

const stdioServerSchema = z
  .object({
    type: z.literal('stdio'),
    command: z.string().regex(SINGLE_EXECUTABLE_TOKEN_PATTERN),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().min(1).optional(),
  })
  .strict();

const agentPluginMcpSchema = z
  .object({
    $schema: z.literal(MCP_SCHEMA_ID),
    mcpServers: z.record(z.string(), stdioServerSchema),
  })
  .strict();

const hostServerSchema = z
  .object({
    command: z.string().regex(SINGLE_EXECUTABLE_TOKEN_PATTERN),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const claudePluginManifestSchema = z.object({
  name: z.string().min(1).regex(PACKAGE_NAME_PATTERN),
  version: z.string().regex(SEMANTIC_VERSION_PATTERN),
  description: z.string().min(1),
  author: authorSchema,
  mcpServers: z.record(z.string(), hostServerSchema),
});

const claudeMarketplaceSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  owner: z.object({ name: z.string().min(1) }),
  plugins: z.array(z.object({ name: z.string().min(1), source: z.literal('./') })).length(1),
});

const geminiExtensionSchema = z.object({
  name: z.string().min(1).regex(SKILL_NAME_PATTERN),
  version: z.string().regex(SEMANTIC_VERSION_PATTERN),
  description: z.string().min(1),
  mcpServers: z.record(z.string(), hostServerSchema),
});

const cursorPluginManifestSchema = z.object({
  name: z.string().min(1).regex(PACKAGE_NAME_PATTERN),
  version: z.string().regex(SEMANTIC_VERSION_PATTERN),
  description: z.string().min(1),
  author: authorSchema,
  logo: z.string().min(1),
});

const codexMarketplaceSchema = z.object({
  name: z.string().min(1),
  plugins: z
    .array(
      z.object({
        name: z.string().min(1),
        source: z.object({ source: z.literal('url'), url: z.string().startsWith('https://') }),
        policy: z.object({
          installation: z.string().min(1),
          authentication: z.string().min(1),
        }),
        category: z.string().min(1),
      }),
    )
    .length(1),
});

type ServerLaunch = z.infer<typeof hostServerSchema>;

interface PackageManifests {
  agentPlugin: z.infer<typeof agentPluginManifestSchema>;
  agentPluginMcp: z.infer<typeof agentPluginMcpSchema>;
  claudePlugin: z.infer<typeof claudePluginManifestSchema>;
  claudeMarketplace: z.infer<typeof claudeMarketplaceSchema>;
  geminiExtension: z.infer<typeof geminiExtensionSchema>;
  cursorPlugin: z.infer<typeof cursorPluginManifestSchema>;
  codexMarketplace: z.infer<typeof codexMarketplaceSchema>;
}

function readRepositoryFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

function readRepositoryJson(relativePath: string): unknown {
  return JSON.parse(readRepositoryFile(relativePath)) as unknown;
}

/**
 * Characters a reviewer cannot see but a model still reads: C0 controls other
 * than tab and line breaks, DEL, zero-width and bidirectional marks, word
 * joiners, the byte-order mark, and Unicode tag characters.
 */
function hiddenCharacters(text: string): string[] {
  const found: string[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const control = (code < 0x20 && !'\t\n\r'.includes(character)) || code === 0x7f;
    const invisible =
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x2064) ||
      code === 0xfeff ||
      (code >= 0xe0000 && code <= 0xe007f);
    if (control || invisible) found.push(`U+${code.toString(16).toUpperCase().padStart(4, '0')}`);
  }
  return found;
}

function schemaProblems(label: string, schema: z.ZodType, candidate: unknown): string[] {
  const parsed = schema.safeParse(candidate);
  if (parsed.success) return [];
  return parsed.error.issues.map(
    (issue) => `${label}: ${issue.path.map(String).join('.') || '(root)'} ${issue.message}`,
  );
}

function splitSkillFile(markdown: string): { frontmatter: unknown; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(markdown);
  if (match === null) throw new Error('SKILL.md must start with YAML frontmatter.');
  return { frontmatter: parseYaml(match[1] ?? '') as unknown, body: match[2] ?? '' };
}

function skillProblems(markdown: string, directoryName: string): string[] {
  const { frontmatter, body } = splitSkillFile(markdown);
  const problems = schemaProblems('SKILL.md frontmatter', skillFrontmatterSchema, frontmatter);
  const parsed = skillFrontmatterSchema.safeParse(frontmatter);
  if (!parsed.success) return problems;

  if (parsed.data.name !== directoryName) {
    problems.push(`skill name "${parsed.data.name}" must match its folder "${directoryName}"`);
  }
  const description = parsed.data.description.toLowerCase();
  for (const term of DESCRIPTION_TRIGGER_TERMS) {
    if (!description.includes(term)) problems.push(`description is missing trigger term "${term}"`);
  }
  for (const verdict of VERDICTS) {
    if (!body.includes(`\`${verdict}\``)) problems.push(`body never names the verdict ${verdict}`);
  }
  for (const command of GATE_COMMANDS) {
    if (!body.includes(command)) problems.push(`body never names the command "${command}"`);
  }
  if (/login\s+--key/u.test(body)) problems.push('body shows a key on a command line');
  if (CREDENTIAL_LIKE_PATTERN.test(markdown))
    problems.push('skill contains a credential-like value');
  if (markdown.split('\n').length >= 500) problems.push('SKILL.md should stay under 500 lines');
  return problems;
}

function serverLaunches(servers: Record<string, ServerLaunch>): string[] {
  return Object.entries(servers)
    .map(([name, { command, args, env }]) =>
      JSON.stringify({ name, command, args: args ?? [], env: env ?? {} }),
    )
    .sort();
}

function serverProblems(label: string, servers: Record<string, ServerLaunch>): string[] {
  const problems: string[] = [];
  for (const [name, server] of Object.entries(servers)) {
    for (const [variable, value] of Object.entries(server.env ?? {})) {
      if (variable === 'PLUGIN_ROOT' || variable === 'PLUGIN_DATA') {
        problems.push(`${label}: server "${name}" must not set the reserved variable ${variable}`);
      }
      if (/key|token|secret|password/iu.test(variable) || CREDENTIAL_LIKE_PATTERN.test(value)) {
        problems.push(`${label}: server "${name}" must not carry a credential in ${variable}`);
      }
    }
  }
  return problems;
}

function consistencyProblems(manifests: PackageManifests): string[] {
  const problems: string[] = [];
  const packageName = manifests.agentPlugin.name;
  const packageVersion = manifests.agentPlugin.version;

  const names: Record<string, string | undefined> = {
    '.claude-plugin/plugin.json': manifests.claudePlugin.name,
    '.claude-plugin/marketplace.json': manifests.claudeMarketplace.plugins[0]?.name,
    'gemini-extension.json': manifests.geminiExtension.name,
    '.cursor-plugin/plugin.json': manifests.cursorPlugin.name,
    '.agents/plugins/marketplace.json': manifests.codexMarketplace.plugins[0]?.name,
  };
  for (const [file, name] of Object.entries(names)) {
    if (name !== packageName) problems.push(`${file}: name must be "${packageName}"`);
  }

  const versions: Record<string, string> = {
    '.claude-plugin/plugin.json': manifests.claudePlugin.version,
    'gemini-extension.json': manifests.geminiExtension.version,
    '.cursor-plugin/plugin.json': manifests.cursorPlugin.version,
  };
  for (const [file, version] of Object.entries(versions)) {
    if (version !== packageVersion) problems.push(`${file}: version must be ${packageVersion}`);
  }

  const expectedLaunches = serverLaunches(manifests.agentPluginMcp.mcpServers);
  const hostLaunches: Record<string, string[]> = {
    '.claude-plugin/plugin.json': serverLaunches(manifests.claudePlugin.mcpServers),
    'gemini-extension.json': serverLaunches(manifests.geminiExtension.mcpServers),
  };
  for (const [file, launches] of Object.entries(hostLaunches)) {
    if (JSON.stringify(launches) !== JSON.stringify(expectedLaunches)) {
      problems.push(`${file}: MCP servers must launch the same way as mcp.json`);
    }
  }

  problems.push(
    ...serverProblems('mcp.json', manifests.agentPluginMcp.mcpServers),
    ...serverProblems('.claude-plugin/plugin.json', manifests.claudePlugin.mcpServers),
    ...serverProblems('gemini-extension.json', manifests.geminiExtension.mcpServers),
  );
  return problems;
}

function loadPackageManifests(): PackageManifests {
  return {
    agentPlugin: agentPluginManifestSchema.parse(readRepositoryJson('plugin.json')),
    agentPluginMcp: agentPluginMcpSchema.parse(readRepositoryJson('mcp.json')),
    claudePlugin: claudePluginManifestSchema.parse(
      readRepositoryJson('.claude-plugin/plugin.json'),
    ),
    claudeMarketplace: claudeMarketplaceSchema.parse(
      readRepositoryJson('.claude-plugin/marketplace.json'),
    ),
    geminiExtension: geminiExtensionSchema.parse(readRepositoryJson('gemini-extension.json')),
    cursorPlugin: cursorPluginManifestSchema.parse(
      readRepositoryJson('.cursor-plugin/plugin.json'),
    ),
    codexMarketplace: codexMarketplaceSchema.parse(
      readRepositoryJson('.agents/plugins/marketplace.json'),
    ),
  };
}

describe('agent skill', () => {
  const skillFile = readRepositoryFile(join(SKILL_DIRECTORY, 'SKILL.md'));

  it('has valid frontmatter, a triggerable description, and names every verdict and gate command', () => {
    expect(skillProblems(skillFile, SKILL_NAME)).toEqual([]);
  });

  it('links only to reference files that exist inside the skill folder', () => {
    const links = [...skillFile.matchAll(/\]\((references\/[^)\s]+)\)/gu)].map((match) => match[1]);

    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(existsSync(join(REPO_ROOT, SKILL_DIRECTORY, link ?? ''))).toBe(true);
    }
  });

  it('rejects a skill whose name differs from its folder', () => {
    expect(skillProblems(skillFile, 'another-folder')).toContain(
      'skill name "autoeval" must match its folder "another-folder"',
    );
  });

  it('rejects a description that is too long or has lost its trigger terms', () => {
    const tooLong = skillFile.replace(/^description: .*$/mu, `description: ${'x'.repeat(1025)}`);
    const untriggerable = skillFile.replace(
      /^description: .*$/mu,
      'description: Helps with things.',
    );

    expect(skillProblems(tooLong, SKILL_NAME).join('\n')).toContain('description');
    expect(skillProblems(untriggerable, SKILL_NAME)).toContain(
      'description is missing trigger term "evaluat"',
    );
  });

  it('rejects a skill that shows a key on a command line', () => {
    const leaking = `${skillFile}\nRun \`autoeval login --key pl_sk_example_value\`.\n`;

    expect(skillProblems(leaking, SKILL_NAME)).toEqual(
      expect.arrayContaining([
        'body shows a key on a command line',
        'skill contains a credential-like value',
      ]),
    );
  });

  it('has no hidden or control characters in the skill or its references', () => {
    const referenceDirectory = join(SKILL_DIRECTORY, 'references');
    const files = [
      join(SKILL_DIRECTORY, 'SKILL.md'),
      ...readdirSync(join(REPO_ROOT, referenceDirectory)).map((name) =>
        join(referenceDirectory, name),
      ),
    ];

    for (const file of files) {
      expect(hiddenCharacters(readRepositoryFile(file)), file).toEqual([]);
    }
  });

  it('rejects text hidden in zero-width or tag characters', () => {
    const hidden = `${skillFile}${String.fromCodePoint(0x200b)}${String.fromCodePoint(0xe0041)}`;

    expect(hiddenCharacters(hidden)).toEqual(['U+200B', 'U+E0041']);
  });
});

describe('agent skill package manifests', () => {
  it('match each host schema and agree on name, version, and MCP launch', () => {
    expect(consistencyProblems(loadPackageManifests())).toEqual([]);
  });

  it('point listing assets at files that are committed', () => {
    const manifests = loadPackageManifests();
    const openAiInterface = manifests.agentPlugin.extensions?.['com.openai'].interface;
    const assetPaths = [
      manifests.cursorPlugin.logo,
      openAiInterface?.logo ?? '',
      openAiInterface?.composerIcon ?? '',
    ];

    for (const assetPath of assetPaths) {
      expect(assetPath).not.toBe('');
      expect(existsSync(join(REPO_ROOT, assetPath))).toBe(true);
    }
  });

  it('rejects an unknown top-level field in the Agent Plugins manifest', () => {
    const manifest = { ...(readRepositoryJson('plugin.json') as object), mcpServers: {} };

    expect(schemaProblems('plugin.json', agentPluginManifestSchema, manifest)).not.toEqual([]);
  });

  it('rejects an MCP command that is a shell string instead of one executable', () => {
    const configuration = {
      $schema: MCP_SCHEMA_ID,
      mcpServers: { 'plumloom-autoeval': { type: 'stdio', command: 'npx -y @plumloom/cli' } },
    };

    expect(schemaProblems('mcp.json', agentPluginMcpSchema, configuration)).not.toEqual([]);
  });

  it('reports a manifest whose version or MCP launch has drifted', () => {
    const manifests = loadPackageManifests();
    const drifted: PackageManifests = {
      ...manifests,
      geminiExtension: {
        ...manifests.geminiExtension,
        version: '9.9.9',
        mcpServers: { 'plumloom-autoeval': { command: 'another-binary' } },
      },
    };

    expect(consistencyProblems(drifted)).toEqual([
      `gemini-extension.json: version must be ${manifests.agentPlugin.version}`,
      'gemini-extension.json: MCP servers must launch the same way as mcp.json',
    ]);
  });

  it('reports a manifest that carries a credential or renames the package', () => {
    const manifests = loadPackageManifests();
    const leaking: PackageManifests = {
      ...manifests,
      cursorPlugin: { ...manifests.cursorPlugin, name: 'renamed-package' },
      agentPluginMcp: {
        ...manifests.agentPluginMcp,
        mcpServers: {
          'plumloom-autoeval': {
            type: 'stdio',
            command: 'autoeval-mcp',
            env: { AUTOEVAL_API_KEY: 'pl_sk_example_value' },
          },
        },
      },
    };

    expect(consistencyProblems(leaking)).toEqual(
      expect.arrayContaining([
        `.cursor-plugin/plugin.json: name must be "${manifests.agentPlugin.name}"`,
        'mcp.json: server "plumloom-autoeval" must not carry a credential in AUTOEVAL_API_KEY',
      ]),
    );
  });
});
