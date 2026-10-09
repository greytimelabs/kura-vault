import { createInterface } from 'readline';
import { Writable } from 'stream';

/**
 * A secret from, in order: the command-line flag, the environment, a prompt
 * that does not echo. Flags are convenient but end up in shell history and the
 * process list; the environment and the prompt do not.
 */
export async function secret(label: string, flag: string | undefined, envName: string): Promise<string> {
  const value = flag ?? process.env[envName];
  if (value) return value;
  if (!process.stdin.isTTY) {
    throw new Error(`${label} is required: set ${envName} or run in a terminal to be asked for it`);
  }

  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try {
    return await new Promise<string>((resolve) => {
      rl.question(`${label}: `, (answer) => {
        process.stdout.write('\n');
        resolve(answer);
      });
      muted = true;
    });
  } finally {
    rl.close();
  }
}
