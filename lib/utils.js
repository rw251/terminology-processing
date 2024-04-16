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
  const keyFilePath = join(getDirName(), '..', 'files', 'keys.json');
  const keyFile = existsSync(keyFilePath)
    ? JSON.parse(readFileSync(keyFilePath, 'utf8'))
    : {};
  keyFile[key] = value;
  writeFileSync(keyFilePath, JSON.stringify(keyFile, null, 2));
}

function heading(msg) {
  console.log(chalk.whiteBright.bgBlue(msg));
}

export { ensureDir, getSnomedDefinitions, getDirName, heading, recordKey };
