import { executeSandboxRunner, writeSafeRunnerError } from './runner.js';

try {
  await executeSandboxRunner();
} catch (error) {
  await writeSafeRunnerError(error);
  process.exitCode = 1;
}
