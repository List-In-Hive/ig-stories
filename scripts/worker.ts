import { workerTick } from '../lib/services';
import { setSetting } from '../lib/db';
console.log('Local worker started. Daily schedule: 08:00 America/Los_Angeles.');
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    stopping = true;
    setSetting('workerHeartbeat', '');
  });
while (!stopping) {
  try {
    await workerTick();
  } catch (error) {
    console.error('Worker:', (error as Error).message);
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
