/*
 * 1. Gets the latest zip file from the TRUD website (unless already downloaded)
 *  - You need a TRUD account
 *  - Put your login detatils in the .env file
 *  - Make sure you are subscribed to "SNOMED CT UK Drug Extension, RF2: Full, Snapshot & Delta"
 * 2.
 *
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';
import { brotliCompress } from '../lib/brotli-compress.js';
import { uploadToR2 } from '../lib/cloudflare.js';
import {
  ensureDir,
  getSnomedDefinitions,
  getDirName,
  recordKey,
} from '../lib/utils.js';

const __dirname = getDirName(import.meta.url);

const FILES_DIR = path.join(__dirname, '..', 'files', 'nhs-pcd-refsets');
const RAW_DIR = ensureDir(path.join(FILES_DIR, 'raw'), true);
const PROCESSED_DIR = ensureDir(path.join(FILES_DIR, 'processed'), true);

let SNOMED_DEFINITIONS;

function getFileNames(dir) {
  const rawFilesDir = path.join(RAW_DIR, dir);
  const version = path.basename(dir);
  const processedFilesDir = path.join(PROCESSED_DIR, dir);
  const definitionJsonFile = path.join(processedFilesDir, 'pcd-defs.json');
  const refSetJsonFile = path.join(processedFilesDir, 'pcd-refSets.json');
  const definitionFileBrotli = path.join(processedFilesDir, 'pcd-defs.json.br');
  const refSetFileBrotli = path.join(processedFilesDir, 'pcd-refSets.json.br');
  return {
    version,
    rawFilesDir,
    definitionJsonFile,
    refSetJsonFile,
    definitionFileBrotli,
    refSetFileBrotli,
    processedFilesDir,
  };
}

async function loadDataIntoMemory({ dirName }) {
  const { processedFilesDir, rawFilesDir, definitionJsonFile, refSetJsonFile } =
    getFileNames(dirName);
  if (existsSync(definitionJsonFile) && existsSync(refSetJsonFile)) {
    log(`The json files already exist so I'll move on...`);
    return dirName;
  }
  ensureDir(processedFilesDir, true);

  const PCD_DIR = path.join(
    rawFilesDir,
    readdirSync(rawFilesDir).filter((x) => x.indexOf('PrimaryCare') > -1)[0]
  );
  const REFSET_DIR = path.join(PCD_DIR, 'Full', 'Refset', 'Content');
  const refsetFile = path.join(
    REFSET_DIR,
    readdirSync(REFSET_DIR).filter((x) => x.indexOf('Simple') > -1)[0]
  );
  const refSets = {};
  const allConcepts = {};
  readFileSync(refsetFile, 'utf8')
    .split('\n')
    .forEach((row) => {
      const [
        id,
        effectiveTime,
        active,
        moduleId,
        refsetId,
        referencedComponentId,
      ] = row.replace(/\r/g, '').split('\t');
      if (id === 'id' || !referencedComponentId) return;
      if (!refSets[refsetId]) {
        allConcepts[refsetId] = true;
        refSets[refsetId] = {};
      }
      if (!refSets[refsetId][id]) {
        refSets[refsetId][id] = {
          effectiveTime,
          conceptId: referencedComponentId,
        };
        if (active === '1') {
          refSets[refsetId][id].active = true;
        }
      } else {
        if (refSets[refsetId][id].conceptId !== referencedComponentId) {
          log(
            `An unexpected error. I thought that if the id (${id}) was the same, then the conceptid (${referencedComponentId}) would be the same.`
          );
          log('Need to rewrite the code...');
          process.exit();
        }
        if (effectiveTime > refSets[refsetId][id].effectiveTime) {
          refSets[refsetId][id].effectiveTime = effectiveTime;
          refSets[refsetId][id].active = active === '1';
        }
      }
      allConcepts[referencedComponentId] = true;
    });
  log(`Ref set file loaded. It has ${Object.keys(refSets).length} rows.`);

  // Now process it a bit
  Object.keys(refSets).forEach((refSetId) => {
    const active = Array.from(
      new Set(
        Object.values(refSets[refSetId])
          .filter((x) => x.active)
          .map((x) => x.conceptId)
      )
    );
    const inactive = Array.from(
      new Set(
        Object.values(refSets[refSetId])
          .filter((x) => !x.active)
          .map((x) => x.conceptId)
      )
    );
    refSets[refSetId] = {
      active,
      inactive,
    };
  });

  SNOMED_DEFINITIONS = getSnomedDefinitions();
  const snomedDefsSize = Object.keys(SNOMED_DEFINITIONS).length;
  const TERM_DIR = path.join(PCD_DIR, 'Full', 'Terminology');
  const descFile = path.join(
    TERM_DIR,
    readdirSync(TERM_DIR).filter((x) => x.indexOf('_Description_') > -1)[0]
  );
  readFileSync(descFile, 'utf8')
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
      if (id === 'id' || !conceptId) return;

      if (!SNOMED_DEFINITIONS[conceptId]) SNOMED_DEFINITIONS[conceptId] = {};
      if (!SNOMED_DEFINITIONS[conceptId][id]) {
        SNOMED_DEFINITIONS[conceptId][id] = { t: term, e: effectiveTime };
        if (active === '1') {
          SNOMED_DEFINITIONS[conceptId][id].a = 1;
        }
        if (typeId === '900000000000003001') {
          SNOMED_DEFINITIONS[conceptId][id].m = 1;
        }
      } else {
        if (effectiveTime > SNOMED_DEFINITIONS[conceptId][id].e) {
          SNOMED_DEFINITIONS[conceptId][id].t = term;
          SNOMED_DEFINITIONS[conceptId][id].e = effectiveTime;
          if (active === '1') {
            SNOMED_DEFINITIONS[conceptId][id].a = 1;
          } else {
            delete SNOMED_DEFINITIONS[conceptId][id].a;
          }
          if (typeId === '900000000000003001') {
            SNOMED_DEFINITIONS[conceptId][id].m = 1;
          } else {
            delete SNOMED_DEFINITIONS[conceptId][id].m;
          }
        }
      }
    });
  //
  log(
    `Description file loaded and added to main SNOMED dictionary.
    Previously the SNOMED dictionary had ${snomedDefsSize} concepts.
    It now has ${Object.keys(SNOMED_DEFINITIONS).length} concepts.`
  );

  const simpleDefs = {};

  Object.keys(allConcepts).forEach((conceptId) => {
    if (SNOMED_DEFINITIONS[conceptId]) {
      // pick best definition

      // if we have any that are active AND main then pick most recent
      const activeAndMainDef = Object.values(SNOMED_DEFINITIONS[conceptId])
        .filter((data) => data.a && data.m)
        .sort((a, b) => {
          if (a.e > b.e) return -1;
          return a.e === b.e ? 0 : 1;
        });

      if (activeAndMainDef.length > 0) {
        simpleDefs[conceptId] = activeAndMainDef[0];
        return;
      }

      // if no mains, but some actives, pick most recent
      const activeAndSynDef = Object.values(SNOMED_DEFINITIONS[conceptId])
        .filter((data) => data.a && !data.m)
        .sort((a, b) => {
          if (a.e > b.e) return -1;
          return a.e === b.e ? 0 : 1;
        });

      if (activeAndSynDef.length > 0) {
        simpleDefs[conceptId] = activeAndSynDef[0];
        return;
      }

      // if main but no actives, pick most recent
      const inactiveAndMainDef = Object.values(SNOMED_DEFINITIONS[conceptId])
        .filter((data) => !data.a && data.m)
        .sort((a, b) => {
          if (a.e > b.e) return -1;
          return a.e === b.e ? 0 : 1;
        });

      if (inactiveAndMainDef.length > 0) {
        simpleDefs[conceptId] = inactiveAndMainDef[0];
        return;
      }

      // no main and no active - investigate
      const inactiveAndMSynDef = Object.values(SNOMED_DEFINITIONS[conceptId])
        .filter((data) => !data.a && !data.m)
        .sort((a, b) => {
          if (a.e > b.e) return -1;
          return a.e === b.e ? 0 : 1;
        });

      if (inactiveAndMSynDef.length > 0) {
        simpleDefs[conceptId] = inactiveAndMSynDef[0];
        return;
      }
      log(`ERROR - no defintions found at all for ${conceptId}`);
    } else {
      //log(conceptId);
      //TODO? maybe keep track of them here?
    }
  });

  const simpleRefSets = {};

  Object.keys(refSets).forEach((refSetId) => {
    if (!simpleDefs[refSetId])
      log(`No description for refset with id: ${refSetId}`);
    else {
      const def = simpleDefs[refSetId].t;
      if (simpleRefSets[def]) log(`There is already an entry for: ${def}`);
      else {
        simpleRefSets[def] = refSets[refSetId];
      }
    }
  });

  // Find snomed codes without definition

  const unknownCodes = Object.values(simpleRefSets)
    .map((x) => x.active.concat(x.inactive))
    .flat()
    .filter((conceptId) => !simpleDefs[conceptId]);

  if (unknownCodes.length > 0) {
    log(
      `There are ${unknownCodes.length} unknown codes. This shouldn't happen.`
    );
    console.log(unknownCodes.join('\n'));
    process.exit();
  }

  writeFileSync(definitionJsonFile, JSON.stringify(simpleDefs, null, 2));
  writeFileSync(refSetJsonFile, JSON.stringify(simpleRefSets, null, 2));

  return dirName;
}

function compressJson(dir) {
  const {
    definitionJsonFile,
    refSetJsonFile,
    definitionFileBrotli,
    refSetFileBrotli,
  } = getFileNames(dir);
  if (existsSync(definitionFileBrotli) && existsSync(refSetFileBrotli)) {
    log(`The brotli files already exist so I'll move on...`);
    return dir;
  }

  log('Starting compression...');

  brotliCompress(refSetJsonFile);
  brotliCompress(definitionJsonFile);
  log(`All compressed.`);
  return dir;
}

async function upload(dir) {
  const { definitionJsonFile, refSetJsonFile, version } = getFileNames(dir);

  const r2Path = path.join('NHS-PCD-REFSET', version);
  await uploadToR2(
    definitionJsonFile,
    path.join(r2Path, path.basename(definitionJsonFile))
  );
  await uploadToR2(
    refSetJsonFile,
    path.join(r2Path, path.basename(refSetJsonFile))
  );
  return r2Path;
}

async function processLatestNHSPCDRefsets() {
  const pcdRefsetLatestFile = path.join(FILES_DIR, 'latest.json');
  if (!existsSync(pcdRefsetLatestFile)) {
    log(
      'There should be a file called latest.json under files/nhs-pcd-refsets/. You need to run again to download the latest zip files.'
    );
    process.exit();
  }
  const latestPcdRefset = JSON.parse(readFileSync(pcdRefsetLatestFile, 'utf8'));
  const dirName = path.basename(latestPcdRefset.outDir);
  const r2Path = await loadDataIntoMemory({ dirName })
    .then(compressJson)
    .then(upload);
  recordKey('nhs-pcd-refset', { name: dirName, r2Path });
}

export { processLatestNHSPCDRefsets };
