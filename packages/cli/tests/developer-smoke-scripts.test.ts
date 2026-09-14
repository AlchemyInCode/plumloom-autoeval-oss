import { readFile, stat } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const BASH_SCRIPT = new URL('../../../examples/smoke/smoke.sh', import.meta.url);
const POWERSHELL_SCRIPT = new URL('../../../examples/smoke/smoke.ps1', import.meta.url);

async function smokeScripts(): Promise<{ bash: string; powershell: string }> {
  const [bash, powershell] = await Promise.all([
    readFile(BASH_SCRIPT, 'utf8'),
    readFile(POWERSHELL_SCRIPT, 'utf8'),
  ]);
  return { bash, powershell };
}

describe('developer smoke reference scripts', () => {
  it('ships equivalent individual workflows for Bash and PowerShell', async () => {
    const { bash, powershell } = await smokeScripts();

    for (const script of [bash, powershell]) {
      expect(script).toContain('fixtures/smoke-scenario.json');
      expect(script).toContain('fixtures/smoke-conversation.json');
      expect(script).toContain('fixtures/smoke-agent-trace.json');
      expect(script).toContain('JUDGE_MODEL_ID');
      expect(script).toContain('PRIMARY_MODEL_ID');
      expect(script).toContain('--judge-model-id');
      expect(script).toContain('--primary-model-id');
      expect(script).toContain('workspace');
      expect(script).toContain('create-from');
      expect(script).toContain('--run');
      expect(script).toContain('results');
      expect(script).toMatch(/--json[\s\S]*results|results[\s\S]*--json/u);
      expect(script).toMatch(/billable/iu);
      expect(script).toMatch(/retained/iu);
    }
  });

  it('uses portable UTC timestamps and no internal polling loop', async () => {
    const { bash, powershell } = await smokeScripts();

    expect(bash).toContain("date -u '+%Y%m%d-%H%M%S'");
    expect(bash).not.toMatch(/date\s+[^\n]*\s-d\b/u);
    expect(bash).not.toContain('-7 hours');
    expect(powershell).toContain("ToUniversalTime().ToString('yyyyMMdd-HHmmss')");

    for (const script of [bash, powershell]) {
      expect(script).not.toMatch(/\bsleep\b/iu);
      expect(script).not.toMatch(/\bstatus\s+['"$]/iu);
    }
  });

  it('contains no embedded credential, account identity, or UUID', async () => {
    const { bash, powershell } = await smokeScripts();
    const realUuidPattern =
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu;

    for (const script of [bash, powershell]) {
      expect(script).not.toMatch(/pl_sk_[a-z0-9]/iu);
      expect(script).not.toContain('userSystemId');
      expect(script).not.toMatch(realUuidPattern);
      expect(script).not.toMatch(/sed\s+-i|Set-Content|Add-Content|Out-File/iu);
    }
  });

  it('marks the Bash entry point executable on Unix', async () => {
    if (process.platform === 'win32') return;
    const metadata = await stat(BASH_SCRIPT);
    expect(metadata.mode & 0o111).not.toBe(0);
  });
});
