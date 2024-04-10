import { readFileSync } from 'fs';
import { sep, posix, join } from 'path';
import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

const Bucket = 'clinical-terminology-files';

let s3;
async function uploadToS3(fullFilePath, fileUploadPath) {
  const posixFilePath = fileUploadPath.split(sep).join(posix.sep);
  const params = {
    Bucket,
    Key: posixFilePath,
  };

  const exists = await s3
    .send(new HeadObjectCommand(params))
    .then((x) => {
      console.log(`> ${fileUploadPath} already exists in R2 so skipping...`);
      return true;
    })
    .catch((err) => {
      if (err.name === 'NotFound') return false;
    });

  if (!exists) {
    console.log(`> ${fileUploadPath} does not exist in R2. Uploading...`);
    await s3.send(
      new PutObjectCommand({
        Bucket,
        Key: posixFilePath,
        Body: readFileSync(`${fullFilePath}.br`),
        ContentEncoding: 'br',
        ContentType: 'application/json',
      })
    );
    console.log('> Uploaded.');
  }
}

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
