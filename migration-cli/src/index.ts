import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import * as path from 'path';
import { scanDirectory } from './scanner';
import { processFile } from './processor';
import { encryptBlob, generateDek, wrapDek, deriveKek, verifyKek, encryptMeta } from './encryptor';
import { uploadAllTiers } from './uploader';
import { ApiClient } from './api-client';
import { ProgressTracker } from './progress';
import { CliOptions } from './types';

const program = new Command();

program
  .name('kura-vault-migrate')
  .description('Bulk upload tool for Kura Vault')
  .requiredOption('--source <path>', 'Source directory containing photos/videos')
  .requiredOption('--vault-id <uuid>', 'Target vault UUID')
  .requiredOption('--passphrase <string>', 'Vault passphrase for encryption')
  .requiredOption('--api-url <url>', 'Backend API URL (e.g., http://localhost:3000/api/v1)')
  .requiredOption('--device-id <string>', 'Device ID for authentication')
  .requiredOption('--password <string>', 'Device password for authentication')
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
  spinner.start('Authenticating...');
  const api = new ApiClient(opts.apiUrl);
  try {
    await api.login(opts.deviceId, opts.password);
    spinner.succeed('Authenticated');
  } catch (err) {
    spinner.fail(`Authentication failed: ${(err as Error).message}`);
    process.exit(1);
  }

  // 2. Derive KEK from passphrase
  spinner.start('Deriving encryption key from passphrase...');
  let kek: Buffer;
  try {
    const vault = (await api.listVaults()).find((v) => v.id === opts.vaultId);
    if (!vault) {
      spinner.fail(`Vault not found: ${opts.vaultId}`);
      process.exit(1);
    }

    kek = await deriveKek(opts.passphrase, Buffer.from(vault.kekSalt, 'base64'));

    // Uploading under the wrong key would leave media nobody can open
    if (!verifyKek(kek, vault)) {
      kek.fill(0);
      spinner.fail('Wrong passphrase for this vault');
      process.exit(1);
    }
    spinner.succeed('Encryption key derived and verified');
  } catch (err) {
    spinner.fail(`Could not derive encryption key: ${(err as Error).message}`);
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

      // Generate DEK and encrypt all tiers
      const dek = generateDek();
      const encThumb = encryptBlob(processed.thumbnail, dek);
      const encPreview = encryptBlob(processed.preview, dek);
      const encOriginal = encryptBlob(processed.original, dek);

      // Wrap DEK with KEK
      const wrapped = wrapDek(dek, kek);

      // Encrypt metadata (including GPS if available)
      const meta = encryptMeta(
        {
          filename: path.basename(filePath),
          originalPath: filePath,
          ...(fileInfo.gpsLatitude != null && { gpsLatitude: fileInfo.gpsLatitude }),
          ...(fileInfo.gpsLongitude != null && { gpsLongitude: fileInfo.gpsLongitude }),
        },
        kek,
      );

      // Init upload via API
      progress.updateStatus(filePath, 'uploading');
      const initResult = await api.uploadInit(opts.vaultId, fileInfo.type, {
        capturedAt: fileInfo.capturedAt,
        width: fileInfo.width,
        height: fileInfo.height,
        durationSeconds: fileInfo.durationSeconds,
        fileSizeBytes: fileInfo.fileSizeBytes,
      });

      // Upload to S3
      await uploadAllTiers(initResult.uploadUrls, {
        thumb: encThumb.encrypted,
        preview: encPreview.encrypted,
        original: encOriginal.encrypted,
      });

      // Complete upload via API
      progress.updateStatus(filePath, 'completing', initResult.mediaId);
      await api.uploadComplete({
        mediaId: initResult.mediaId,
        vaultId: opts.vaultId,
        encryptedDek: wrapped.encryptedDek.toString('base64'),
        dekNonce: wrapped.nonce.toString('base64'),
        thumbIv: encThumb.iv.toString('base64'),
        previewIv: encPreview.iv.toString('base64'),
        originalIv: encOriginal.iv.toString('base64'),
        encryptedMeta: meta.encrypted,
        metaNonce: meta.nonce,
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

  // Zero out KEK
  kek.fill(0);
  progress.close();
}
