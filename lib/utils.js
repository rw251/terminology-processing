import { mkdirSync, existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function ensureDir(filePath, isDir) {
  mkdirSync(isDir ? filePath : path.dirname(filePath), { recursive: true });
  return filePath;
}

function getDirName(fileUrl = import.meta.url) {
  return path.dirname(fileURLToPath(fileUrl));
}

function getSnomedDefinitions() {
  // Check that SNOMED definitions exist on this pc
  const DEFINITION_FILE = path.join(
    getDirName(),
    '..',
    'snomed',
    'files',
    'processed',
    'latest',
    'defs.json'
  );
  if (!existsSync(DEFINITION_FILE)) {
    console.log(`This project relies on the SNOMED directory being populated.`);
    process.exit();
  }
  const definitions = JSON.parse(readFileSync(DEFINITION_FILE, 'utf8'));
  return definitions;
}

export { ensureDir, getSnomedDefinitions, getDirName };