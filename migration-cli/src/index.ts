import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import * as path from 'path';
import { scanDirectory } from './scanner';
import { processFile } from './processor';
import { encryptMedia, openCreatorVaultKey, openSharedVaultKey, unlockAccount, unwrapAlbumKey } from './encryptor';
import { uploadAllTiers } from './uploader';
import { ApiClient } from './api-client';
import { ProgressTracker } from './progress';
import { secret } from './prompt';
import { CliOptions, Identity } from './types';

const program = new Command();

program
  .name('kura-vault-migrate')
  .description('Bulk upload tool for Kura Vault')
  .requiredOption('--source <path>', 'Source directory containing photos/videos')
  .requiredOption('--vault-id <uuid>', 'Target vault UUID')
  .option('--album-id <uuid>', 'Also put every file into this album of the vault')
  .requiredOption('--api-url <url>', 'Backend API URL (e.g., http://localhost:3000/api/v1)')
  .requiredOption('--username <string>', 'Username for authentication')
  // The three secrets are asked for when not given. Prefer that, or the
  // environment, to flags: flags are saved in shell history.
  .option('--password <string>', 'Account password (or KURA_PASSWORD)')
  .option('--master-passphrase <string>', 'Master passphrase of the account (or KURA_MASTER_PASSPHRASE)')
  .option('--passphrase <string>', 'Passphrase of the vault, for a vault you created (or KURA_VAULT_PASSPHRASE)')
  .option('--concurrency <number>', 'Number of concurrent uploads', '5')
  .option('--resume', 'Resume a previous migration', false)
  .action(run);

program.parse();

async function run(opts: CliOptions): Promise<void> {
  const spinner = ora();
  const concurrency = Number(opts.concurrency) || 5;

  console.log(chalk.bold('\nKura Vault Migration Tool\n'));
  console.log(`Source:      ${opts.source}`);
  console.log(`Vault:       ${opts.vaultId}`);
  console.log(`API:         ${opts.apiUrl}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log('');

  // 1. Login
  const api = new ApiClient(opts.apiUrl);
  try {
    const password = await secret('Password', opts.password, 'KURA_PASSWORD');
    spinner.start('Authenticating...');
    await api.login(opts.username, password);
    spinner.succeed('Authenticated');
  } catch (err) {
    spinner.fail(`Authentication failed: ${(err as Error).message}`);
    process.exit(1);
  }

  // 2. Unlock the account, then the vault. Nothing here is sent to the server.
  let identity: Identity;
  let vaultKey: Buffer;
  let album: { id: string; key: Buffer } | undefined;
  try {
    const account = await api.getAccount();
    const masterPassphrase = await secret('Master passphrase', opts.masterPassphrase, 'KURA_MASTER_PASSPHRASE');
    spinner.start('Unlocking your keys...');
    identity = await unlockAccount(account, masterPassphrase);
    spinner.succeed('Keys unlocked');

    const vault = (await api.listVaults()).find((v) => v.id === opts.vaultId);
    if (!vault) {
      spinner.fail(`Vault not found, or not shared with this account: ${opts.vaultId}`);
      process.exit(1);
    }
    if (vault.role !== 'creator' && vault.permission !== 'write') {
      spinner.fail('This vault is shared with you for viewing only');
      process.exit(1);
    }

    if (vault.role === 'creator') {
      const passphrase = await secret('Vault passphrase', opts.passphrase, 'KURA_VAULT_PASSPHRASE');
      spinner.start('Opening the vault...');
      // Uploading under the wrong key would leave media nobody can open
      const opened = await openCreatorVaultKey(vault, passphrase, identity);
      if (!opened) {
        spinner.fail('Wrong passphrase for this vault');
        process.exit(1);
      }
      vaultKey = opened;
    } else {
      // Shared with this account: the key arrives sealed to its public key, signed by the sharer
      spinner.start('Opening the vault...');
      vaultKey = openSharedVaultKey(vault, identity);
    }

    if (opts.albumId) {
      const row = (await api.listAlbums(opts.vaultId)).find((a) => a.id === opts.albumId && a.kind === 'regular');
      if (!row || !row.keyWrapped || !row.keyNonce) {
        spinner.fail(`Album not found in this vault: ${opts.albumId}`);
        process.exit(1);
      }
      album = {
        id: row.id,
        key: unwrapAlbumKey({ id: row.id, keyWrapped: row.keyWrapped, keyNonce: row.keyNonce }, opts.vaultId, vaultKey),
      };
    }
    spinner.succeed('Vault opened');
  } catch (err) {
    spinner.fail(`Could not open the vault: ${(err as Error).message}`);
    process.exit(1);
  }

  // 3. Scan source directory
  spinner.start('Scanning source directory...');
  const files = await scanDirectory(opts.source);
  spinner.succeed(`Found ${files.length} media files`);

  if (files.length === 0) {
    console.log(chalk.yellow('\nNo media files found. Exiting.'));
    return;
  }

  // 4. Initialize progress tracker
  const progress = new ProgressTracker(opts.source);
  for (const file of files) {
    progress.addFile(file.path);
  }

  // Always check progress DB — skip files already 'done' even on first run
  const pending = progress.getPendingFiles();
  console.log(chalk.cyan(`\nFiles to process: ${pending.length}`));

  if (pending.length === 0) {
    console.log(chalk.green('\nAll files already processed!'));
    progress.close();
    return;
  }

  // 5. Process files with concurrency control
  let completed = 0;
  let failed = 0;
  const fileMap = new Map(files.map((f) => [f.path, f]));

  const processOne = async (filePath: string): Promise<void> => {
    const fileInfo = fileMap.get(filePath);
    if (!fileInfo) return;

    try {
      // Mark as processing
      progress.updateStatus(filePath, 'processing');

      // Generate thumbnails/previews
      const processed = await processFile(fileInfo);

      // The server issues the item's id first: every ciphertext made below is bound to it
      progress.updateStatus(filePath, 'uploading');
      const initResult = await api.uploadInit({
        vaultId: opts.vaultId,
        ...(album ? { albumId: album.id } : {}),
        mediaType: fileInfo.type,
        fileSizeBytes: fileInfo.fileSizeBytes,
      });

      // A fresh key for this file, wrapped under the vault key (and the album's);
      // the tiers and the metadata (including GPS if available) are encrypted under it
      const encrypted = encryptMedia({
        mediaId: initResult.mediaId,
        vaultId: opts.vaultId,
        vaultKey,
        album,
        thumb: processed.thumbnail,
        preview: processed.preview,
        original: processed.original,
        meta: {
          filename: path.basename(filePath),
          originalPath: filePath,
          ...(fileInfo.gpsLatitude != null && { gpsLatitude: fileInfo.gpsLatitude }),
          ...(fileInfo.gpsLongitude != null && { gpsLongitude: fileInfo.gpsLongitude }),
        },
      });

      // Upload to S3
      await uploadAllTiers(initResult.uploadUrls, {
        thumb: encrypted.thumb.encrypted,
        preview: encrypted.preview.encrypted,
        original: encrypted.original.encrypted,
      });

      // Complete upload via API
      progress.updateStatus(filePath, 'completing', initResult.mediaId);
      await api.uploadComplete({
        mediaId: initResult.mediaId,
        vaultId: opts.vaultId,
        ...(album ? { albumId: album.id } : {}),
        mediaType: fileInfo.type,
        // Structural metadata the server sorts and pages by
        ...(fileInfo.capturedAt ? { capturedAt: fileInfo.capturedAt } : {}),
        ...(fileInfo.width && fileInfo.height ? { width: fileInfo.width, height: fileInfo.height } : {}),
        ...(fileInfo.durationSeconds ? { durationSeconds: Math.round(fileInfo.durationSeconds) } : {}),
        fileSizeBytes: fileInfo.fileSizeBytes,
        keyWrappedVault: encrypted.keyWrappedVault,
        keyNonceVault: encrypted.keyNonceVault,
        ...(encrypted.keyWrappedAlbum ? { keyWrappedAlbum: encrypted.keyWrappedAlbum, keyNonceAlbum: encrypted.keyNonceAlbum } : {}),
        thumbIv: encrypted.thumb.iv.toString('base64'),
        previewIv: encrypted.preview.iv.toString('base64'),
        originalIv: encrypted.original.iv.toString('base64'),
        encryptedMeta: encrypted.encryptedMeta,
        metaNonce: encrypted.metaNonce,
      });

      progress.updateStatus(filePath, 'done', initResult.mediaId);
      completed++;
    } catch (err) {
      progress.updateStatus(filePath, 'failed', undefined, (err as Error).message);
      failed++;
      console.error(chalk.red(`  Failed: ${path.basename(filePath)} - ${(err as Error).message}`));
    }
  };

  // Run with concurrency limit
  spinner.start(`Processing 0/${pending.length}...`);

  const queue = [...pending];
  const workers: Promise<void>[] = [];

  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const filePath = queue.shift()!;
          await processOne(filePath);
          spinner.text = `Processing ${completed + failed}/${pending.length} (${completed} done, ${failed} failed)`;
        }
      })(),
    );
  }

  await Promise.all(workers);
  spinner.succeed(`Completed: ${completed} done, ${failed} failed out of ${pending.length}`);

  // Summary
  const summary = progress.getSummary();
  console.log(chalk.bold('\nFinal Summary:'));
  console.log(`  Done:    ${summary.done}`);
  console.log(`  Failed:  ${summary.failed}`);
  console.log(`  Pending: ${summary.pending}`);

  if (summary.failed > 0) {
    console.log(chalk.yellow(`\nRun with --resume to retry ${summary.failed} failed files.`));
  }

  // Zero out every key
  vaultKey.fill(0);
  album?.key.fill(0);
  identity.encSk.fill(0);
  identity.signSk.fill(0);
  progress.close();
}
