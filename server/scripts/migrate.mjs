// Applies schema.sql (idempotent) by loading the db module, then exits.
import { dbPath } from '../src/db.mjs';

console.log(`schema applied -> ${dbPath}`);
process.exit(0);
