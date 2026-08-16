// @ts-check
import { runCoreTests } from './core-test.js';

if (!runCoreTests()) {
  process.exitCode = 1;
}
