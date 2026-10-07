import { migrate } from '../lib/db';
import { seed } from '../lib/seed';
import { syncAdminPassword } from '../lib/auth';
migrate();
if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD) {
  console.error('Set ADMIN_PASSWORD (12+ characters) before starting in production.');
  process.exit(1);
}
if (syncAdminPassword()) console.log('Admin password updated from ADMIN_PASSWORD.');
if (process.argv[2] === 'seed' || process.argv[2] === 'seed-if-empty') await seed();
else console.log('Migrations applied.');
