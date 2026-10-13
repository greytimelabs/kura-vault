// A stand-in for the storage bucket that keeps blobs in memory: pre-signed PUT,
// GET and DELETE against any path. Signatures are not checked; what matters to
// the tests is which ciphertext arrives, and that deleted items really go.
import { createServer, type Server } from 'node:http';

/** Lists every stored path. Not something real storage has. */
export const KEYS_PATH = '/__keys';

export interface MemoryStorage {
  /** Path (bucket included) to bytes. */
  blobs: Map<string, Buffer>;
  /** While true every DELETE fails, as if storage were unreachable. */
  failDeletes: boolean;
  server: Server;
}

export function startMemoryStorage(port: number): MemoryStorage {
  const storage: MemoryStorage = {
    blobs: new Map(),
    failDeletes: false,
    server: createServer((req, res) => {
      const key = new URL(req.url ?? '/', 'http://x').pathname;
      if (req.method === 'GET' && key === KEYS_PATH) {
        // For a test in another process: what is in storage right now
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify([...storage.blobs.keys()]));
      } else if (req.method === 'PUT') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          storage.blobs.set(key, Buffer.concat(chunks));
          res.writeHead(200).end();
        });
      } else if (req.method === 'GET' && storage.blobs.has(key)) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(storage.blobs.get(key));
      } else if (req.method === 'DELETE') {
        if (storage.failDeletes) {
          res.writeHead(503).end();
          return;
        }
        // As S3 does: deleting what is not there succeeds
        storage.blobs.delete(key);
        res.writeHead(204).end();
      } else {
        res.writeHead(404).end();
      }
    }),
  };
  storage.server.listen(port, '127.0.0.1');
  return storage;
}
