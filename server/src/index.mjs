import { createApp } from './app.mjs';
import { dbPath } from './db.mjs';
import { tokenRolesConfigured } from './auth.mjs';

const PORT = Number(process.env.PORT) || 4000;

const missing = ['ADMIN_TOKEN', 'NODE_TOKEN'].filter((k) => !process.env[k]);
if (missing.length) {
  console.warn(
    `[warn] ${missing.join(', ')} not set — those roles will be refused. ` +
      'Copy .env.example to .env and fill them in.',
  );
}

createApp().listen(PORT, () => {
  console.log(`sonicaccess-server on :${PORT}`);
  console.log(`  db: ${dbPath}`);
  console.log(`  roles configured: ${tokenRolesConfigured().join(', ') || '(none)'}`);
});
