import chalk from 'chalk';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

function ensureDir(filePath, isDir) {
  mkdirSync(isDir ? filePath : dirname(filePath), { recursive: true });
  return filePath;
}

function getDirName(fileUrl = import.meta.url) {
  return dirname(fileURLToPath(fileUrl));
}

function getSnomedDefinitions() {
  // Check that SNOMED definitions exist on this pc
  const DEFINITION_FILE = join(
    getDirName(),
    '..',
    'files',
    'snomed',
    'processed',
    'latest',
    'defs.json'
  );
  if (!existsSync(DEFINITION_FILE)) {
    console.log(`This project relies on the SNOMED directory being populated.`);
    process.exit();
  }
  console.log('> Loading the SNOMED dictionary into memory...');
  const definitions = JSON.parse(readFileSync(DEFINITION_FILE, 'utf8'));
  console.log('> SNOMED dictionary loaded.');
  return definitions;
}

function recordKey(key, value) {
  const keyFilePath = join(getDirName(), '..', 'web', 'keys.json');
  const keyFile = existsSync(keyFilePath)
    ? JSON.parse(readFileSync(keyFilePath, 'utf8'))
    : {};
  keyFile[key] = value;
  writeFileSync(keyFilePath, JSON.stringify(keyFile, null, 2));
}

let indent = 0;
function heading(msg) {
  console.log(chalk.whiteBright.bgBlue(msg));
  indent = 0;
}
function subheading(msg) {
  console.log(chalk.whiteBright.bgBlue(msg));
  indent = 1;
}

function log(msg) {
  // Pull out filenames to highlight and truncate
  let match = msg.match(/(^|.*?)([^ \n\\]*\\[^ ]+\.[^ \\]+)((?:^|\s).*)$/);
  if (match) {
    const [, start, file, end] = match;
    if (file.indexOf('terminology-processing') > -1) {
      console.log(
        `> ${start}${chalk.yellowBright(
          file.split('terminology-processing')[1]
        )}${end}`
      );
    } else {
      console.log(`> ${start}${chalk.yellowBright(file)}${end}`);
    }
  } else {
    console.log(`> ${msg}`);
  }
}

function assignAltIds(SNOMED_DEFINITIONS) {
  let next = 1;
  const chars =
    '0123456789!£€#$%&()*+,-./:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}~';
  const charLength = chars.length;

  function nToRichardBase(n) {
    let output = [];
    do {
      let index = n % charLength;
      output.unshift(chars[index]);
      n = Math.trunc(n / charLength);
    } while (n != 0);
    return output.join('');
  }
  function nextId() {
    const str = nToRichardBase(next);
    next++;
    return str;
  }

  const allSnomedCodes = {};
  Object.keys(SNOMED_DEFINITIONS).forEach((conceptId) => {
    if (!allSnomedCodes[conceptId]) {
      allSnomedCodes[conceptId] = nextId();
    }
  });
  return allSnomedCodes;
}

export { ensureDir, getSnomedDefinitions, getDirName, heading, log, recordKey, assignAltIds };
