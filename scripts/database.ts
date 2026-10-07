import { migrate } from '../lib/db';
import { seed } from '../lib/seed';
migrate();
if (process.argv[2] === 'seed' || process.argv[2] === 'seed-if-empty') await seed();
else console.log('Migrations applied.');
