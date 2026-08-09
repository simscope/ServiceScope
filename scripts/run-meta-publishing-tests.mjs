import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const outputRoot = await mkdtemp(join(tmpdir(), 'servicescope-meta-publishing-'));
try {
  await writeFile(join(outputRoot, 'package.json'), '{"type":"module"}\n', 'utf8');
  run(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'),
    'src/features/meta-publishing/contracts.ts',
    'src/features/meta-publishing/workspaceState.ts',
    '--target', 'ES2020',
    '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext',
    '--outDir', outputRoot,
    '--skipLibCheck',
  ]);
  run(process.execPath, ['scripts/meta-publishing-regression-tests.mjs'], {
    META_PUBLISHING_COMPILED_ROOT: outputRoot,
  });
  run(process.execPath, ['scripts/meta-scheduled-ui-regression-tests.mjs'], {
    META_PUBLISHING_COMPILED_ROOT: outputRoot,
  });
  run(process.execPath, ['scripts/meta-scheduled-worker-regression-tests.mjs']);
} finally {
  await rm(outputRoot, { recursive: true, force: true });
}

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
