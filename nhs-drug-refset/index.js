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
import { ensureDir, getSnomedDefinitions, getDirName } from '../lib/utils.js';

const __dirname = getDirName(import.meta.url);

const FILES_DIR = path.join(__dirname, '..', 'files', 'snomed', 'drugs');
const RAW_DIR = ensureDir(path.join(FILES_DIR, 'raw'), true);
const PROCESSED_DIR = ensureDir(
  path.join(__dirname, '..', 'files', 'nhs-drug-refsets', 'processed'),
  true
);

let SNOMED_DEFINITIONS;

function getFileNames(dirName) {
  const rawFilesDir = path.join(RAW_DIR, dirName);
  const version = path.basename(dirName);
  const processedFilesDir = path.join(PROCESSED_DIR, dirName);
  const definitionFile1 = path.join(processedFilesDir, 'defs-0-9999.json');
  const definitionFile2 = path.join(processedFilesDir, 'defs-10000+.json');
  const refSetFile1 = path.join(processedFilesDir, 'refSets-0-9999.json');
  const refSetFile2 = path.join(processedFilesDir, 'refSets-10000+.json');
  const definitionFileBrotli1 = path.join(
    processedFilesDir,
    'defs-0-9999.json.br'
  );
  const definitionFileBrotli2 = path.join(
    processedFilesDir,
    'defs-10000+.json.br'
  );
  const refSetFile1Brotli = path.join(
    processedFilesDir,
    'refSets-0-9999.json.br'
  );
  const refSetFile2Brotli = path.join(
    processedFilesDir,
    'refSets-10000+.json.br'
  );
  return {
    version,
    rawFilesDir,
    definitionFile1,
    definitionFile2,
    refSetFile1,
    refSetFile2,
    definitionFileBrotli1,
    definitionFileBrotli2,
    refSetFile1Brotli,
    refSetFile2Brotli,
    processedFilesDir,
  };
}

async function loadDataIntoMemory({ dirName }) {
  const {
    processedFilesDir,
    rawFilesDir,
    definitionFile1,
    definitionFile2,
    refSetFile1,
    refSetFile2,
  } = getFileNames(dirName);
  if (
    existsSync(definitionFile1) &&
    existsSync(definitionFile2) &&
    existsSync(refSetFile1) &&
    existsSync(refSetFile2)
  ) {
    console.log(`> The json files already exist so I'll move on...`);
    return { dirName };
  }
  ensureDir(processedFilesDir, true);

  const DRUG_DIR = path.join(
    rawFilesDir,
    readdirSync(rawFilesDir).filter((x) => x.indexOf('Drug') > -1)[0]
  );
  const REFSET_DIR = path.join(DRUG_DIR, 'Full', 'Refset', 'Content');
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
          console.log(
            `An unexpected error. I thought that if the id (${id}) was the same, then the conceptid (${referencedComponentId}) would be the same.`
          );
          console.log('Need to rewrite the code...');
          process.exit();
        }
        if (effectiveTime > refSets[refsetId][id].effectiveTime) {
          refSets[refsetId][id].effectiveTime = effectiveTime;
          refSets[refsetId][id].active = active === '1';
        }
      }
      allConcepts[referencedComponentId] = true;
    });
  console.log(
    `> Ref set file loaded. It has ${Object.keys(refSets).length} rows.`
  );
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
  const TERM_DIR = path.join(DRUG_DIR, 'Full', 'Terminology');
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
  console.log(
    `> Description file loaded and added to main SNOMED dictionary.
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
      console.log(`ERROR - no defintions found at all for ${conceptId}`);
    } else {
      console.log(
        `> The conceptId (${conceptId}) was not found in the snomed dictionary.`
      );
    }
  });

  const simpleRefSets = {};

  Object.keys(refSets).forEach((refSetId) => {
    if (!simpleDefs[refSetId])
      console.log(`No description for refset with id: ${refSetId}`);
    else {
      const def = simpleDefs[refSetId].t;
      if (simpleRefSets[def])
        console.log(`There is already an entry for: ${def}`);
      else {
        simpleRefSets[def] = refSets[refSetId];
      }
    }
  });

  const simpleRefSetsLT10000 = {};
  const simpleRefSets10000PLUS = {};
  Object.keys(refSets).forEach((refSetId) => {
    if (!simpleDefs[refSetId])
      console.log(`No description for refset with id: ${refSetId}`);
    else {
      let simpleRefSets =
        refSets[refSetId].active.length + refSets[refSetId].inactive.length <
        10000
          ? simpleRefSetsLT10000
          : simpleRefSets10000PLUS;
      const def = simpleDefs[refSetId].t;
      if (simpleRefSets[def])
        console.log(`There is already an entry for: ${def}`);
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
    console.log(
      `> There are ${unknownCodes.length} unknown codes. This shouldn't happen.`
    );
    console.log(unknownCodes.join('\n'));
    process.exit();
  }

  const simpleDefsLT10000 = {};
  const simpleDefs10000PLUS = {};

  Object.values(simpleRefSetsLT10000)
    .map((x) => x.active.concat(x.inactive))
    .flat()
    .forEach((conceptId) => {
      simpleDefsLT10000[conceptId] = simpleDefs[conceptId];
    });

  Object.values(simpleRefSets10000PLUS)
    .map((x) => x.active.concat(x.inactive))
    .flat()
    .forEach((conceptId) => {
      if (simpleDefs[conceptId])
        simpleDefs10000PLUS[conceptId] = simpleDefs[conceptId].t;
    });

  writeFileSync(definitionFile1, JSON.stringify(simpleDefsLT10000, null, 2));
  writeFileSync(definitionFile2, JSON.stringify(simpleDefs10000PLUS, null, 2));
  writeFileSync(refSetFile1, JSON.stringify(simpleRefSetsLT10000, null, 2));
  writeFileSync(refSetFile2, JSON.stringify(simpleRefSets10000PLUS, null, 2));

  return { dirName };
}

function compressJson({ dirName }) {
  const {
    definitionFile1,
    definitionFile2,
    refSetFile1,
    refSetFile2,
    definitionFileBrotli1,
    definitionFileBrotli2,
    refSetFile1Brotli,
    refSetFile2Brotli,
  } = getFileNames(dirName);
  if (
    existsSync(definitionFileBrotli1) &&
    existsSync(definitionFileBrotli2) &&
    existsSync(refSetFile1Brotli) &&
    existsSync(refSetFile2Brotli)
  ) {
    console.log(`> The brotli files already exist so I'll move on...`);
    return { dirName };
  }

  console.log('> Starting compression. TAKES A WHILE - GO GET A CUP OF TEA!');

  brotliCompress(refSetFile1);
  brotliCompress(refSetFile2);
  brotliCompress(definitionFile1);
  brotliCompress(definitionFile2);
  console.log(`> All compressed.`);
  return { dirName };
}

async function upload({ dirName }) {
  const {
    definitionFile1,
    definitionFile2,
    refSetFile1,
    refSetFile2,
    version,
  } = getFileNames(dirName);

  await uploadToR2(
    definitionFile1,
    path.join('NHS-DRUG-REFSET', version, path.basename(definitionFile1))
  );
  await uploadToR2(
    definitionFile2,
    path.join('NHS-DRUG-REFSET', version, path.basename(definitionFile2))
  );
  await uploadToR2(
    refSetFile1,
    path.join('NHS-DRUG-REFSET', version, path.basename(refSetFile1))
  );
  await uploadToR2(
    refSetFile2,
    path.join('NHS-DRUG-REFSET', version, path.basename(refSetFile2))
  );
}

async function processLatestNHSDrugRefsets() {
  const drugRefsetLatestFile = path.join(FILES_DIR, 'latest.json');
  if (!existsSync(drugRefsetLatestFile)) {
    console.log(
      '> There should be a file called latest.json under files/snomed/drugs. You need to run again to download the latest zip files.'
    );
    process.exit();
  }
  const latestDrugRefset = JSON.parse(
    readFileSync(drugRefsetLatestFile, 'utf8')
  );
  await loadDataIntoMemory({ dirName: path.basename(latestDrugRefset.outDir) })
    .then(compressJson)
    .then(upload);
}

export { processLatestNHSDrugRefsets };
