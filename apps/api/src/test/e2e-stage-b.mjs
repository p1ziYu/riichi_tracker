// The built guard runs before the built suite (also used by node --test).
import '../../dist/test/e2e-db-guard.js';
import '../../dist/test/e2e-stage-b.test.js';
