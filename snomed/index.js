/*
 * 1. Gets the latest SNOMED zip file from the TRUD website (unless already downloaded)
 *  - You need a TRUD account
 *  - Put your login detatils in the .env file
 *  - Make sure you are subscribed to "SNOMED CT UK Drug Extension, RF2: Full, Snapshot & Delta"
 * 2.
 *
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  createWriteStream,
  createReadStream,
  copyFileSync,
} from 'fs';
import { once } from 'node:events';
import readline from 'readline';
import { brotliCompress } from '../lib/brotli-compress.js';
import { JsonStreamStringify } from 'json-stream-stringify';
import path from 'path';
import { uploadToR2 } from '../lib/cloudflare.js';
import { generateTrie, processWords } from '../lib/word-utils.js';
import {
  ensureDir,
  getDirName,
  recordKey,
  heading,
  log,
  assignAltIds,
} from '../lib/utils.js';

const __dirname = getDirName(import.meta.url);

const FILES_DIR = path.join(__dirname, '..', 'files', 'snomed');
const MAIN_DIR = path.join(FILES_DIR, 'main');
const DRUGS_DIR = path.join(FILES_DIR, 'drugs');
const MAIN_RAW_DIR = path.join(MAIN_DIR, 'raw');
const DRUGS_RAW_DIR = path.join(DRUGS_DIR, 'raw');
const PROCESSED_DIR = ensureDir(path.join(FILES_DIR, 'processed'), true);

function getFileNames({ dirName, drugDirName }) {
  const snomedId = `${dirName}-${drugDirName}`;
  const match = snomedId.match(
    /_([0-9]+\.[0-9]+\.[0-9]+_[0-9]{8})[0-9]{6}Z-.*_([0-9]+\.[0-9]+\.[0-9]+_[0-9]{8})[0-9]{6}Z/
  );
  const version = match[1] > match[2] ? match[1] : match[2];

  const rawFilesDir = path.join(MAIN_RAW_DIR, dirName);
  const drugRawFilesDir = path.join(DRUGS_RAW_DIR, drugDirName);
  const processedFilesDir = path.join(PROCESSED_DIR, snomedId);
  const singleDefinitionFile = path.join(processedFilesDir, 'defs-single.json');
  const definitionFile = path.join(processedFilesDir, 'defs.json');
  const readableDefinitionFile = path.join(
    processedFilesDir,
    'defs-readable.json'
  );

  const relationsFile = path.join(processedFilesDir, 'relationships.json');
  const readableRelationsFile = path.join(
    processedFilesDir,
    'relationships-readable.json'
  );

  const trieFile = path.join(processedFilesDir, 'trie.json');
  const wordsFile = path.join(processedFilesDir, 'words-hash.json');
  const lookupFile = path.join(processedFilesDir, 'words-lookup.json');

  return {
    rawFilesDir,
    drugRawFilesDir,
    definitionFile,
    singleDefinitionFile,
    readableDefinitionFile,
    relationsFile,
    readableRelationsFile,
    processedFilesDir,
    version,
    latestDefsFile: path.join(PROCESSED_DIR, 'latest', 'defs.json'),
    latestReadableDefsFile: path.join(
      PROCESSED_DIR,
      'latest',
      'defs-readable.json'
    ),
    latestSingleDefsFile: path.join(
      PROCESSED_DIR,
      'latest',
      'defs-single.json'
    ),
    latestRelationsFile: path.join(
      PROCESSED_DIR,
      'latest',
      'relationships.json'
    ),
    latestReadableRelationsFile: path.join(
      PROCESSED_DIR,
      'latest',
      'relationships-readable.json'
    ),
    trieFile,
    wordsFile,
    lookupFile,
    latestTrieFile: path.join(PROCESSED_DIR, 'latest', 'trie.json'),
    latestWordsFile: path.join(PROCESSED_DIR, 'latest', 'words-hash.json'),
    latestLookupFile: path.join(PROCESSED_DIR, 'latest', 'lookup.json'),
  };
}

let definitions = {};
let relationships = {};
let relationshipTEMP = {};
function getBestDefinition(conceptId) {
  // if we have any that are active AND main then pick most recent
  const activeAndMainDef = Object.values(definitions[conceptId])
    .filter((data) => data.a && data.m)
    .sort((a, b) => {
      if (a.e > b.e) return -1;
      return a.e === b.e ? 0 : 1;
    });

  if (activeAndMainDef.length > 0) {
    return activeAndMainDef[0].t;
  }

  // if no mains, but some actives, pick most recent
  const activeAndSynDef = Object.values(definitions[conceptId])
    .filter((data) => data.a && !data.m)
    .sort((a, b) => {
      if (a.e > b.e) return -1;
      return a.e === b.e ? 0 : 1;
    });

  if (activeAndSynDef.length > 0) {
    return activeAndSynDef[0].t;
  }

  // if main but no actives, pick most recent
  const inactiveAndMainDef = Object.values(definitions[conceptId])
    .filter((data) => !data.a && data.m)
    .sort((a, b) => {
      if (a.e > b.e) return -1;
      return a.e === b.e ? 0 : 1;
    });

  if (inactiveAndMainDef.length > 0) {
    return inactiveAndMainDef[0].t;
  }

  // no main and no active - investigate
  const inactiveAndMSynDef = Object.values(definitions[conceptId])
    .filter((data) => !data.a && !data.m)
    .sort((a, b) => {
      if (a.e > b.e) return -1;
      return a.e === b.e ? 0 : 1;
    });

  if (inactiveAndMSynDef.length > 0) {
    return inactiveAndMSynDef[0].t;
  }
}
async function loadDataIntoMemoryHelper(rawFilesDir) {
  for (let directory of readdirSync(rawFilesDir)) {
    const descriptionFileDir = path.join(
      rawFilesDir,
      directory,
      'Full',
      'Terminology'
    );
    const descriptionFile = path.join(
      descriptionFileDir,
      readdirSync(descriptionFileDir)[0]
    );
    log(`Reading the description file ${descriptionFile}...`);
    readFileSync(descriptionFile, 'utf8')
      .split('\n')
      .forEach((row) => {
        const [
          id,
          effectiveTime,
          active,
          moduleId,
          conceptId,
          languageCode,
          typeId,
          term,
          caseSignificanceId,
        ] = row.replace(/\r/g, '').split('\t');
        if (id === 'id' || id === '') return;
        if (!definitions[conceptId]) definitions[conceptId] = {};
        if (!definitions[conceptId][id]) {
          definitions[conceptId][id] = { t: term, e: effectiveTime };
          if (active === '1') {
            definitions[conceptId][id].a = 1;
          }
          if (typeId === '900000000000003001') {
            definitions[conceptId][id].m = 1;
          }
        } else {
          if (effectiveTime > definitions[conceptId][id].e) {
            definitions[conceptId][id].t = term;
            definitions[conceptId][id].e = effectiveTime;
            if (active === '1') {
              definitions[conceptId][id].a = 1;
            } else {
              delete definitions[conceptId][id].a;
            }
            if (typeId === '900000000000003001') {
              definitions[conceptId][id].m = 1;
            } else {
              delete definitions[conceptId][id].m;
            }
          }
        }
      });

    const relationshipFileDir = path.join(
      rawFilesDir,
      directory,
      'Full',
      'Terminology'
    );
    const relationshipFile = path.join(
      relationshipFileDir,
      readdirSync(relationshipFileDir)[1]
    );

    log(`Reading the relationship file ${relationshipFile}...`);

    const rl = readline.createInterface({
      input: createReadStream(relationshipFile),
      terminal: false,
    });

    rl.on('line', (line) => {
      const [
        id,
        effectiveTime,
        active,
        moduleId,
        sourceId,
        destinationId,
        relationshipGroup,
        typeId,
        characteristicTypeId,
        modifierId,
      ] = line.replace(/\r/g, '').split('\t');
      if (id === 'id' || id === '' || typeId !== '116680003') return;
      if (!relationshipTEMP[id]) {
        relationshipTEMP[id] = {
          active,
          effectiveTime,
          sourceId,
          destinationId,
        };
      } else {
        if (effectiveTime > relationshipTEMP[id].effectiveTime) {
          relationshipTEMP[id].active = active;
          relationshipTEMP[id].effectiveTime = effectiveTime;
          relationshipTEMP[id].sourceId = sourceId;
          relationshipTEMP[id].destinationId = destinationId;
        }
      }
    });

    await once(rl, 'close');

    Object.values(relationshipTEMP).forEach(
      ({ active, sourceId, destinationId }) => {
        if (active === '1') {
          if (!relationships[destinationId]) relationships[destinationId] = {};
          relationships[destinationId][sourceId] = true;
        }
      }
    );
  }
}

async function loadDataIntoMemory({ dirName, drugDirName }) {
  const {
    processedFilesDir,
    definitionFile,
    singleDefinitionFile,
    readableDefinitionFile,
    rawFilesDir,
    drugRawFilesDir,
    relationsFile,
    readableRelationsFile,
  } = getFileNames({ dirName, drugDirName });
  if (
    existsSync(definitionFile) &&
    existsSync(singleDefinitionFile) &&
    existsSync(readableDefinitionFile) &&
    existsSync(relationsFile) &&
    existsSync(readableRelationsFile)
  ) {
    log(
      `The json files already exist so I'll move on once I've loaded the definition file into memory...`
    );
    definitions = JSON.parse(readFileSync(definitionFile, 'utf8'));
    log('Definitions loaded.');
    return { dirName, drugDirName };
  }

  ensureDir(processedFilesDir, true);

  await loadDataIntoMemoryHelper(rawFilesDir);
  await loadDataIntoMemoryHelper(drugRawFilesDir);

  //
  log(
    `Description file loaded. It has ${Object.keys(definitions).length} rows.`
  );
  log('Writing the description data to 3 JSON files.');
  log('First is defs-readable.json...');

  await new Promise((resolve) => {
    const readableJsonStream = new JsonStreamStringify(definitions, null, 2);
    const streamReadable = createWriteStream(ensureDir(readableDefinitionFile));
    readableJsonStream.pipe(streamReadable);
    readableJsonStream.on('end', () => {
      log('defs-readable.json written');
      return resolve();
    });
  });

  log('Now defs.json...');
  await new Promise((resolve) => {
    const jsonStream = new JsonStreamStringify(definitions);

    const stream = createWriteStream(ensureDir(definitionFile));
    jsonStream.pipe(stream);
    jsonStream.on('end', () => {
      log('defs.json written');
      return resolve();
    });
  });

  log('Create a new lookup with just one definition per concept id...');
  const bestDefs = {};
  Object.keys(definitions).forEach((conceptId) => {
    bestDefs[conceptId] = getBestDefinition(conceptId);
  });

  log('Now defs-single.json...');
  await new Promise((resolve) => {
    const jsonStream = new JsonStreamStringify(bestDefs);

    const stream = createWriteStream(ensureDir(singleDefinitionFile));
    jsonStream.pipe(stream);
    jsonStream.on('end', () => {
      log('defs-single.json written');
      return resolve();
    });
  });

  log(
    `Relationships file loaded. It has ${
      Object.keys(relationships).length
    } rows.`
  );
  log('Writing the relationship data to 2 JSON files.');
  log('First is relationships-readable.json...');

  await new Promise((resolve) => {
    const readableJsonStream = new JsonStreamStringify(relationships, null, 2);
    const streamReadable = createWriteStream(ensureDir(readableRelationsFile));
    readableJsonStream.pipe(streamReadable);
    readableJsonStream.on('end', () => {
      log('relationships-readable.json written');
      return resolve();
    });
  });

  log('Now relationships.json...');
  await new Promise((resolve) => {
    const jsonStream = new JsonStreamStringify(relationships);

    const stream = createWriteStream(ensureDir(relationsFile));
    jsonStream.pipe(stream);
    jsonStream.on('end', () => {
      log('relationships.json written');
      return resolve();
    });
  });

  return { dirName, drugDirName };
}

function compress({ dirName, drugDirName }) {
  const {
    singleDefinitionFile,
    relationsFile,
    trieFile,
    wordsFile,
    lookupFile,
  } = getFileNames({
    dirName,
    drugDirName,
  });
  brotliCompress(singleDefinitionFile);
  brotliCompress(relationsFile);
  brotliCompress(trieFile);
  brotliCompress(wordsFile);
  brotliCompress(lookupFile);
  return { dirName, drugDirName };
}

async function upload({ dirName, drugDirName }) {
  const {
    singleDefinitionFile,
    relationsFile,
    trieFile,
    wordsFile,
    version,
    lookupFile,
  } = getFileNames({
    dirName,
    drugDirName,
  });
  const r2Path = path.join('SNOMED', version);
  await uploadToR2(
    singleDefinitionFile,
    path.join(r2Path, path.basename(singleDefinitionFile))
  );
  await uploadToR2(
    relationsFile,
    path.join(r2Path, path.basename(relationsFile))
  );
  await uploadToR2(trieFile, path.join(r2Path, path.basename(trieFile)));
  await uploadToR2(wordsFile, path.join(r2Path, path.basename(wordsFile)));
  await uploadToR2(lookupFile, path.join(r2Path, path.basename(lookupFile)));
  recordKey('snomed', { name: dirName, r2Path });
  return { dirName, drugDirName };
}

function copyToLatest({ dirName, drugDirName }) {
  const {
    latestDefsFile,
    latestReadableDefsFile,
    definitionFile,
    singleDefinitionFile,
    readableDefinitionFile,
    latestSingleDefsFile,
    latestRelationsFile,
    latestReadableRelationsFile,
    relationsFile,
    readableRelationsFile,
    trieFile,
    latestTrieFile,
    wordsFile,
    latestWordsFile,
    lookupFile,
    latestLookupFile,
  } = getFileNames({ dirName, drugDirName });

  log('Copying defs.json to latest directory...');
  // just copy to latest
  copyFileSync(definitionFile, ensureDir(latestDefsFile));
  log('Copying defs-readable.json to latest directory...');
  copyFileSync(readableDefinitionFile, ensureDir(latestReadableDefsFile));
  log('Copying defs-single.json to latest directory...');
  copyFileSync(singleDefinitionFile, ensureDir(latestSingleDefsFile));
  log('Copying relationships.json to latest directory...');
  // just copy to latest
  copyFileSync(relationsFile, ensureDir(latestRelationsFile));
  log('Copying relationships-readable.json to latest directory...');
  copyFileSync(readableRelationsFile, ensureDir(latestReadableRelationsFile));
  log('Copying trie.json to latest directory...');
  copyFileSync(trieFile, ensureDir(latestTrieFile));
  log('Copying words-hash.json to latest directory...');
  copyFileSync(wordsFile, ensureDir(latestWordsFile));
  log('Copying lookup.json to latest directory...');
  copyFileSync(lookupFile, ensureDir(latestLookupFile));
  log('All files copied.');
}

function createTrie({ dirName, drugDirName }) {
  const { processedFilesDir, trieFile } = getFileNames({
    dirName,
    drugDirName,
  });

  if (existsSync(trieFile)) {
    log('trie.json already exists so no need to recreate.');
    return { dirName, drugDirName };
  }

  const definitionsArray = Object.values(definitions)
    .map((def) => {
      return Object.values(def)
        .filter((x) => x.a)
        .map((x) => x.t);
    })
    .flat();
  generateTrie(definitionsArray, processedFilesDir);
  return { dirName, drugDirName };
}

function createWordDictionary({ dirName, drugDirName }) {
  const { processedFilesDir, wordsFile } = getFileNames({
    dirName,
    drugDirName,
  });

  if (existsSync(wordsFile)) {
    log('words-hash.json already exists so no need to recreate.');
    return { dirName, drugDirName };
  }

  const lookup = assignAltIds(definitions);

  const definitionsObject = {};
  Object.entries(definitions).forEach(([snomedCode, defObj]) => {
    definitionsObject[snomedCode] = Object.values(defObj)
      .filter((x) => x.a)
      .map((x) => x.t);
  });
  processWords(definitionsObject, processedFilesDir, lookup);
  return { dirName, drugDirName };
}

async function processLatestSNOMED() {
  heading('Process latest SNOMED');
  const snomedLatestFile = path.join(MAIN_DIR, 'latest.json');
  const snomedLatestDrugFile = path.join(DRUGS_DIR, 'latest.json');
  if (!existsSync(snomedLatestFile) || !existsSync(snomedLatestDrugFile)) {
    log(
      'There should be files called latest.json under files/xxx. You need to run again to download the latest zip files.'
    );
    process.exit();
  }
  const latestSNOMED = JSON.parse(readFileSync(snomedLatestFile, 'utf8'));
  const latestSNOMEDDrug = JSON.parse(
    readFileSync(snomedLatestDrugFile, 'utf8')
  );

  await loadDataIntoMemory({
    dirName: path.basename(latestSNOMED.outDir),
    drugDirName: path.basename(latestSNOMEDDrug.outDir),
  })
    .then(createTrie)
    .then(createWordDictionary)
    .then(compress)
    .then(upload)
    .then(copyToLatest);
}

export { processLatestSNOMED };
