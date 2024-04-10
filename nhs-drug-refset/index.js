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
import decompress from 'decompress';
import { brotliCompress } from '../lib/brotli-compress.js';
import { uploadToR2 } from '../lib/cloudflare.js';
import { getLatestDrugRefsetUrl, downloadFile } from '../lib/trud.js';
import { ensureDir, getSnomedDefinitions, getDirName } from '../lib/utils.js';

const __dirname = getDirName(import.meta.url);

const FILES_DIR = path.join(__dirname, 'files');
const ZIP_DIR = ensureDir(path.join(FILES_DIR, 'zip'), true);
const RAW_DIR = ensureDir(path.join(FILES_DIR, 'raw'), true);
const PROCESSED_DIR = ensureDir(path.join(FILES_DIR, 'processed'), true);
const CODE_LOOKUP = path.join(FILES_DIR, 'code-lookup.json');

const existingFiles = readdirSync(ZIP_DIR);

const SNOMED_DEFINITIONS = getSnomedDefinitions();

async function downloadIfNotExists(url) {
  const filename = url.split('/').reverse()[0].split('?')[0];
  console.log(`> The most recent zip file on TRUD is ${filename}`);

  if (existingFiles.indexOf(filename) > -1) {
    console.log(`> The zip file already exists so no need to download again.`);
    return filename;
  }

  console.log(`> That zip is not stored locally. Downloading...`);
  const outputFile = path.join(ZIP_DIR, filename);

  await downloadFile(url, outputFile);

  return filename;
}

async function extractZip(zipFile) {
  const name = zipFile.replace('.zip', '');
  const file = path.join(ZIP_DIR, zipFile);
  const outDir = path.join(RAW_DIR, name);
  if (existsSync(outDir)) {
    console.log(
      `> The directory ${outDir} already exists, so I'm not unzipping.`
    );
    return name;
  }
  console.log(`> The directory ${outDir} does not yet exist. Creating...`);
  ensureDir(outDir, true);
  console.log(`> Extracting files from the zip...`);
  const files = await decompress(file, outDir, {
    filter: (file) => {
      if (file.path.toLowerCase().indexOf('full') > -1) return true;
      if (file.path.toLowerCase().indexOf('readme') > -1) return true;
      if (file.path.toLowerCase().indexOf('information') > -1) return true;
      return false;
    },
  });
  console.log(`> ${files.length} files extracted.`);
  return name;
}

function getFileNames(dir, startingFromProjectDir) {
  const rawFilesDir = path.join(RAW_DIR, dir);
  const version = path.basename(dir);
  const processedFilesDir = path.join(PROCESSED_DIR, dir);
  const processedFilesDirShallow = startingFromProjectDir
    ? path.join('files', 'processed', dir)
    : processedFilesDir;
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
    processedFilesDirShallow,
  };
}

async function loadDataIntoMemory(dir) {
  const {
    processedFilesDir,
    rawFilesDir,
    definitionFile1,
    definitionFile2,
    refSetFile1,
    refSetFile2,
  } = getFileNames(dir);
  if (
    existsSync(definitionFile1) &&
    existsSync(definitionFile2) &&
    existsSync(refSetFile1) &&
    existsSync(refSetFile2)
  ) {
    console.log(`> The json files already exist so I'll move on...`);
    // const definitions = JSON.parse(readFileSync(definitionFile));
    // const refSets = JSON.parse(readFileSync(definitionFile));
    return dir;
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
      //console.log(conceptId);
      //TODO? maybe keep track of them here?
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

  // First get the lookup of unknown codes
  const knownCodeLookup = existsSync(CODE_LOOKUP)
    ? JSON.parse(readFileSync(CODE_LOOKUP, 'utf8'))
    : {};

  const unknownCodes = Object.values(simpleRefSets)
    .map((x) => x.active.concat(x.inactive))
    .flat()
    .filter((conceptId) => !simpleDefs[conceptId])
    .map((conceptId) => {
      if (knownCodeLookup[conceptId]) {
        simpleDefs[conceptId] = knownCodeLookup[conceptId];
        return false;
      }
      return conceptId;
    })
    .filter(Boolean);

  if (unknownCodes.length > 0) {
    console.log(
      `> There are ${unknownCodes.length} codes without a definition.term`
    );
    console.log(`> Attempting to look them up in the NHS SNOMED browser...`);
  }

  async function process40UnknownConcepts(items) {
    console.log(`Looking up next 40 (out of ${items.length})`);
    const next40 = items.splice(0, 40);
    const fetches = next40.map((x) => {
      return fetch(
        `https://termbrowser.nhs.uk/sct-browser-api/snomed/uk-edition/v20230927/concepts/${x}`
      ).then((x) => x.json());
    });
    const results = await Promise.all(fetches).catch((err) => {
      console.log(
        'Error retrieving data from NHS SNOMED browser. Rerunning will probably be fine.'
      );
      process.exit();
    });
    results.forEach(({ conceptId, fsn, effectiveTime, active }) => {
      const def = {
        t: fsn,
        e: effectiveTime,
        m: 1,
      };
      if (active) def.a = 1;
      knownCodeLookup[conceptId] = def;
      simpleDefs[conceptId] = def;
    });
    writeFileSync(CODE_LOOKUP, JSON.stringify(knownCodeLookup, null, 2));
    const next = 2000 + Math.random() * 5000;
    if (items.length > 0) {
      console.log(`Waiting ${next} milliseconds before next batch...`);
      return new Promise((resolve) => {
        setTimeout(async () => {
          await process40UnknownConcepts(items);
          return resolve();
        }, next);
      });
    }
  }

  if (unknownCodes.length > 0) {
    await process40UnknownConcepts(unknownCodes);
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

  return dir;
}

function compressJson(dir) {
  const {
    definitionFile1,
    definitionFile2,
    refSetFile1,
    refSetFile2,
    definitionFileBrotli1,
    definitionFileBrotli2,
    refSetFile1Brotli,
    refSetFile2Brotli,
  } = getFileNames(dir);
  if (
    existsSync(definitionFileBrotli1) &&
    existsSync(definitionFileBrotli2) &&
    existsSync(refSetFile1Brotli) &&
    existsSync(refSetFile2Brotli)
  ) {
    console.log(`> The brotli files already exist so I'll move on...`);
    // const definitions = JSON.parse(readFileSync(definitionFile));
    // const refSets = JSON.parse(readFileSync(definitionFile));
    return dir;
  }

  console.log('> Starting compression. TAKES A WHILE - GO GET A CUP OF TEA!');

  brotliCompress(refSetFile1);
  brotliCompress(refSetFile2);
  brotliCompress(definitionFile1);
  brotliCompress(definitionFile2);
  console.log(`> All compressed.`);
  return dir;
}

async function upload(dir) {
  const {
    definitionFile1,
    definitionFile2,
    refSetFile1,
    refSetFile2,
    version,
  } = getFileNames(dir, true);

  console.log(version);
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
  await getLatestDrugRefsetUrl()
    .then(downloadIfNotExists)
    .then(extractZip)
    .then(loadDataIntoMemory)
    .then(compressJson)
    .then(upload);
}

export { processLatestNHSDrugRefsets };
