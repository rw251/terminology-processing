import {
  createWriteStream,
  readdirSync,
  existsSync,
  createReadStream,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import unzip from 'unzip-stream';
import 'dotenv/config';
import { ensureDir, getDirName } from './utils.js';

const __dirname = getDirName(import.meta.url);

let Cookie;

/**
 * Attempts to log in to TRUD and save the session cookie
 */
async function login() {
  if (Cookie) return;
  const email = process.env.email;
  const password = process.env.password;

  if (!email) {
    console.log('Need email=xxx in the .env file');
    process.exit();
  }
  if (!password) {
    console.log('Need password=xxx in the .env file');
    process.exit();
  }

  console.log('> Logging in to TRUD...');
  const result = await fetch(
    'https://isd.digital.nhs.uk/trud/security/j_spring_security_check',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      redirect: 'manual',
      body: new URLSearchParams({
        j_username: email,
        j_password: password,
        commit: 'LOG+IN',
      }),
    }
  );
  const cookies = result.headers.getSetCookie();
  const cookie = cookies.filter((x) => x.indexOf('JSESSIONID') > -1)[0];
  console.log('> Logged in, and cookie cached.');
  Cookie = cookie;
}

const baseTrudUrl =
  'https://isd.digital.nhs.uk/trud/users/authenticated/filters/0/categories/';

/**
 * Finds all recent downloads of a particular item from TRUD
 * @param {string} item The partial url of the item to search for
 * @returns {Array} An array of urls for the downloads
 */
async function getTrudUrls(item) {
  await login();
  const response = await fetch(`${baseTrudUrl}${item}`, {
    headers: { Cookie },
  });
  const html = await response.text();
  const urls = html
    .match(/https:\/\/isd.digital.nhs.uk\/download[^"]+(?:")/g)
    .map((zipFileUrl) => {
      const [, zipFileName] = zipFileUrl.match(/\/([^/]+.zip)/);
      return { zipFileUrl, zipFileName };
    });

  return { urls };
}

async function downloadFile(url, filePath) {
  await login();

  const stream = createWriteStream(filePath);
  const { body } = await fetch(url, { headers: { Cookie } });
  await finished(Readable.fromWeb(body).pipe(stream));
  console.log(`> File downloaded.`);
}

const TRUD = {
  nhsPcdRefsets: {
    name: 'NHS PCD refsest',
    url: '8/items/659/releases',
    directory: ensureDir(join(__dirname, '..', 'files', 'nhs-pcd-refsets')),
    zipFileRegex: [/full.+content.+refset_simple/, /full.+sct2_description/],
  },
  snomedCodes: {
    name: 'SNOMED codes',
    url: '26/items/101/releases',
    directory: ensureDir(join(__dirname, '..', 'files', 'snomed', 'main')),
    zipFileRegex: [/full.+sct2_description/, /full.+sct2_relationship_/],
  },
  snomedDrugCodes: {
    name: 'SNOMED dn+d codes',
    url: '26/items/105/releases',
    directory: ensureDir(join(__dirname, '..', 'files', 'snomed', 'drugs')),
    zipFileRegex: [
      /full.+content.+refset_simple/,
      /full.+sct2_description/,
      /full.+sct2_relationship_/,
    ],
  },
};

function fileDirectoryPaths(directoryPath) {
  const ZIP_DIR = ensureDir(join(directoryPath, 'zip'), true);
  const RAW_DIR = ensureDir(join(directoryPath, 'raw'), true);
  return { ZIP_DIR, RAW_DIR };
}

async function downloadAndExtractLatestZips() {
  await login();
  for (let { url, directory, name, zipFileRegex } of Object.values(TRUD)) {
    // 1. Get URLs and file folders
    const { ZIP_DIR, RAW_DIR } = fileDirectoryPaths(directory);
    const existingFiles = readdirSync(ZIP_DIR);
    const { urls } = await getTrudUrls(url);

    // 2. Download zip files if not already
    // for now let's just do the most recent
    const { zipFileUrl, zipFileName } = urls[0];
    if (existingFiles.indexOf(zipFileName) > -1) {
      console.log(
        `> The latest zip file for '${name}' already exists so no need to download again.`
      );
    } else {
      console.log(
        `> The latest zip file for '${name}' is not stored locally. Downloading...`
      );
      const outputFile = join(ZIP_DIR, zipFileName);
      await downloadFile(zipFileUrl, outputFile);
    }

    // 3. Extract zips if not already
    const dirName = zipFileName.replace('.zip', '');
    const file = join(ZIP_DIR, zipFileName);
    const outDir = join(RAW_DIR, dirName);
    writeFileSync(
      join(directory, 'latest.json'),
      JSON.stringify({ zipFileName, outDir })
    );
    if (existsSync(outDir)) {
      console.log(
        `> The directory ${outDir} already exists, so I'm not unzipping.`
      );
    } else {
      console.log(`> The directory ${outDir} does not yet exist. Creating...`);
      ensureDir(outDir, true);
      console.log(`> Extracting files from the zip...`);
      let toUnzip = 0;
      let unzipped = 0;
      let isRead = false;
      await new Promise((resolve) => {
        createReadStream(file)
          .pipe(unzip.Parse())
          .on('entry', function (entry) {
            if (
              zipFileRegex.filter((regex) =>
                entry.path.toLowerCase().match(regex)
              ).length > 0
            ) {
              console.log(`> Extracting ${entry.path}...`);
              toUnzip++;
              const outputFilePath = join(outDir, entry.path);
              const outStream = createWriteStream(ensureDir(outputFilePath));
              outStream.on('finish', () => {
                console.log(`> Extracted ${entry.path}.`);
                unzipped++;
                if (isRead && toUnzip === unzipped) {
                  return resolve();
                }
              });
              entry.pipe(outStream);
            } else {
              entry.autodrain();
            }
          })
          .on('end', () => {
            console.log(`> Finished reading zip file.`);
            isRead = true;
            if (toUnzip === unzipped) {
              return resolve();
            }
          });
      });
      console.log(`> ${unzipped} files extracted.`);
    }
  }
}

export { downloadAndExtractLatestZips };
