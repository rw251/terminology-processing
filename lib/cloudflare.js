import { readFileSync, copyFileSync } from 'fs';
import { sep, posix, join } from 'path';
import 'dotenv/config';
import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { ensureDir, log, getDirName } from './utils.js';

const __dirname = getDirName(import.meta.url);

const Bucket = 'clinical-terminology-files';
let s3;

/**
 * Takes a file and uploads it to R2 storage in Cloudflare via the S3 client
 * @param {string} fullFilePath The full file path of the file to upload
 * @param {string} fileUploadPath The relative file path to store in cloudflare
 */
async function uploadToS3(fullFilePath, fileUploadPath) {
  const posixFilePath = fileUploadPath.split(sep).join(posix.sep);
  const params = {
    Bucket,
    Key: posixFilePath,
  };

  // local copy for local dev purposes
  const jsonWebPath = ensureDir(join(__dirname, '..', 'web', posixFilePath));
  copyFileSync(fullFilePath, jsonWebPath);
  const brotliWebPath = join(__dirname, '..', 'web', `${posixFilePath}.br`);
  copyFileSync(`${fullFilePath}.br`, brotliWebPath);

  const exists = await s3
    .send(new HeadObjectCommand(params))
    .then((x) => {
      log(`${fileUploadPath} already exists in R2 so skipping...`);
      return true;
    })
    .catch((err) => {
      if (err.name === 'NotFound') return false;
    });

  if (!exists) {
    log(`${fileUploadPath} does not exist in R2. Uploading...`);
    await s3.send(
      new PutObjectCommand({
        Bucket,
        Key: posixFilePath,
        Body: readFileSync(`${fullFilePath}.br`),
        ContentEncoding: 'br',
        ContentType: 'application/json',
      })
    );
    log('Uploaded.');
  }
}

/**
 * Takes a file and uploads it to R2 storage in Cloudflare
 * @param {string} fullFilePath The full file path of the file to upload
 * @param {string} fileUploadPath The relative file path to store in cloudflare
 */
async function uploadToR2(fullFilePath, fileUploadPath) {
  const accessKeyId = `${process.env.ACCESS_KEY_ID}`;
  const secretAccessKey = `${process.env.SECRET_ACCESS_KEY}`;
  const endpoint = `https://${process.env.ACCOUNT_ID}.r2.cloudflarestorage.com`;

  s3 = new S3Client({
    region: 'auto',
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    endpoint,
  });

  await uploadToS3(fullFilePath, fileUploadPath);
}

export { uploadToR2 };
