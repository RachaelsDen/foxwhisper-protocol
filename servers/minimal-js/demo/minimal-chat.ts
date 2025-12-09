import { MinimalServer } from '../src/server.js';
import { FoxClient } from '../../../clients/minimal-js/src/client.js';
import { createToyAead } from '../../../clients/minimal-js/src/testCrypto.js';
import type { ClientLogger, KeyAgreement, SessionKeys } from '../../../clients/minimal-js/src/types.js';

const log: ClientLogger = (event, meta) => {
  const ts = new Date().toISOString();
  console.log(`[demo ${ts}]`, event, meta ?? '');
};

const sharedKeys: SessionKeys = { encKey: 'demo-key', authKey: 'demo-auth', nonce: 'demo-nonce' };
const sharedKeyAgreement: KeyAgreement = {
  deriveSessionKeys: () => sharedKeys,
};

async function run() {
  const server = new MinimalServer({ port: 0, logger: (event, meta) => console.log('[server]', event, meta) });
  const address = server.address();
  if (!(typeof address === 'object' && address?.port)) throw new Error('Failed to get server port');
  const url = `ws://localhost:${address.port}`;

  const clientA = new FoxClient({
    serverUrl: url,
    clientId: 'client-a',
    deviceId: 'device-a',
    x25519PublicKey: 'cli-x',
    kyberPublicKey: 'cli-k',
    insecureCrypto: true,
    crypto: { keyAgreement: sharedKeyAgreement, aead: createToyAead() },
    logger: (e, m) => log(`A:${e}`, m),
  });

  const clientB = new FoxClient({
    serverUrl: url,
    clientId: 'client-b',
    deviceId: 'device-b',
    x25519PublicKey: 'cli-x',
    kyberPublicKey: 'cli-k',
    insecureCrypto: true,
    crypto: { keyAgreement: sharedKeyAgreement, aead: createToyAead() },
    logger: (e, m) => log(`B:${e}`, m),
  });

  try {
    await Promise.all([clientA.connect(), clientB.connect()]);
    await Promise.all([clientA.join('demo-room'), clientB.join('demo-room')]);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const recvA: any[] = [];
    const recvB: any[] = [];
    clientA.on('message', (msg) => {
      recvA.push(msg);
      log('A:message', msg as any);
    });
    clientB.on('message', (msg) => {
      recvB.push(msg);
      log('B:message', msg as any);
    });

    await clientA.sendData('demo-room', { hello: 'from A' });
    await clientB.sendData('demo-room', { hello: 'from B' });

    await new Promise((resolve) => setTimeout(resolve, 200));

    const ok = recvA.length === 2 && recvB.length === 2;
    if (!ok) {
      console.error('[demo] FAILED: expected A=2, B=2 messages, got A=%d, B=%d', recvA.length, recvB.length);
      process.exit(1);
    }

    clientA.close();
    clientB.close();
    await server.close();
    process.exit(0);
  } catch (err) {
    console.error('Demo failed', err);
    clientA.close();
    clientB.close();
    await server.close();
    process.exit(1);
  }
}

run();
