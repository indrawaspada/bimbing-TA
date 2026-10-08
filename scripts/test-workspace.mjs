// Portable, disposable SQL validation. No hosted connection, Auth, Storage service,
// or HTTP status validation: real PostgreSQL WASM applies all migrations and RLS.
import { spawnSync } from "node:child_process";
console.log(
  "VALIDATION MODE: real PostgreSQL WASM SQL; synthetic REST/Auth/Storage. Hosted integration NOT tested.",
);
const r = spawnSync(
  process.execPath,
  [
    "--test",
    "--test-concurrency=1",
    "tests/workspace/flows.test.mjs",
    "tests/workspace/serializers.test.mjs",
  ],
  { stdio: "inherit", env: { ...process.env, TEST_SQL_WASM: "1" } },
);
process.exit(r.status ?? 1);
