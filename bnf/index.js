/*
 * 1. Gets the latest BNF zip file from nhsbsa
 * 2.
 *
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';

import { read, utils } from 'xlsx';
import { join, basename } from 'path';
import { brotliCompress } from '../lib/brotli-compress.js';
import { uploadToR2 } from '../lib/cloudflare.js';
import {
  getDirName,
  ensureDir,
  heading,
  recordKey,
  log,
} from '../lib/utils.js';
import { parse } from 'csv-parse/sync';
const __dirname = getDirName(import.meta.url);

const FILES_DIR = join(__dirname, '..', 'files', 'bnf');
const RAW_DIR = ensureDir(join(FILES_DIR, 'raw'), true);
const PROCESSED_DIR = ensureDir(join(FILES_DIR, 'processed'), true);
const HIER_DIR = ensureDir(join(RAW_DIR, 'hierarchy'), true);

function getFileNames(dirName) {
  const version = basename(dirName);
  const rawFilesDir = join(RAW_DIR, dirName);
  const processedFilesDir = join(PROCESSED_DIR, dirName);
  const mappingFile = join(processedFilesDir, 'bnf-map.json');
  const mappingFileBrotli = join(processedFilesDir, 'bnf-map.json.br');
  const readableMappingFile = join(processedFilesDir, 'bnf-map-readable.json');
  const hierarchyJsonFile = join(processedFilesDir, 'bnf-hierarchy.json');
  const hierarchyFileBrotli = join(processedFilesDir, 'bnf-hierarchy.json.br');

  return {
    version,
    rawFilesDir,
    mappingFile,
    mappingFileBrotli,
    readableMappingFile,
    processedFilesDir,
    hierarchyJsonFile,
    hierarchyFileBrotli,
  };
}

const mapping = {};
const failed = {
  __description:
    "Items that can't be mapped to BNF codes because there isn't a direct map, or a similar enough description.",
  items: {},
};
const multiple = {
  __description:
    "Identical descriptions that map to multiple BNF codes. Probably fine as long as there aren't many, but recording in case useful later.",
};
const multiple2 = {
  __description:
    'Similar descriptions (ignoring final bracketed expression such as pharma company) that map to multiple BNF codes. Probably fine, but recording in case useful later.',
  sameProductFirst11Chars: {},
  sameChemicalFirst9Chars: {},
  rest: {},
};
const alternative = {
  __description:
    "Items without a BNF mapping, but where a similar description is found so we use that BNF code instead. This could lead to problems if the usage of this was to look up BNF codes, but if we're just using the hierarchy to find codes then it is fine.",
};

async function loadDataIntoMemoryHelper(dirName) {
  const file = readdirSync(join(RAW_DIR, dirName))[0];
  log('Loading the mapping xlsx file...');
  const buf = readFileSync(join(RAW_DIR, dirName, file));
  const workbook = read(buf);
  const sheet_name_list = workbook.SheetNames;
  log('Loaded. Processing the data...');
  const xlData = utils.sheet_to_json(workbook.Sheets[sheet_name_list[0]]);
  if (
    !xlData ||
    xlData.length < 2 ||
    !xlData[0]['BNF Code'] ||
    !xlData[0]['SNOMED Code']
  ) {
    log('ERROR 33h: ');
    process.exit();
  }
  const descriptions = {};
  const otherDefs = {};
  xlData.forEach(
    ({
      'BNF Code': bnfCode,
      'SNOMED Code': snomedCode,
      'BNF Name': bnfName,
      'DM+D: Product Description': description,
      // 'DM+D: Product and Pack Description': packDescription,
    }) => {
      // description = packDescription || description;
      if (bnfCode && bnfName) {
        if (!descriptions[bnfName]) descriptions[bnfName] = bnfCode;
        else if (descriptions[bnfName] !== bnfCode) {
          // log(`Multiple defs for ${bnfCode}`);
          if (!multiple[bnfName]) multiple[bnfName] = true;
        }
        const isShortDef = bnfName.match(/^(.+) \([^()]+\)$/);
        if (isShortDef) {
          const shortDef = isShortDef[1];
          if (!otherDefs[shortDef]) {
            otherDefs[shortDef] = bnfCode;
          } else if (otherDefs[shortDef] !== bnfCode) {
            // This means that there are at least two similar definitions
            // with different BNF codes. Typically this wont matter as
            // they will be very similar codes. But we check anyway
            if (
              otherDefs[shortDef].substring(0, 11) === bnfCode.substring(0, 11)
            ) {
              multiple2.sameProductFirst11Chars[shortDef] = true;
            } else if (
              otherDefs[shortDef].substring(0, 9) === bnfCode.substring(0, 9)
            ) {
              multiple2.sameChemicalFirst9Chars[shortDef] = true;
            } else {
              multiple2.rest[shortDef] = true;
            }
          }
        }
      }
      if (!bnfCode) {
        // attempt to find it
        const attempt = description.match(
          /^(.+)\([^()]+(?:\([^()]+\))?[^)]+\) [0-9]+ (.+)$/
        );
        const shortDescription = attempt
          ? attempt[1] + attempt[2]
          : description.split(' (')[0];
        if (
          descriptions[shortDescription] ||
          descriptions[`${shortDescription} tablets`]
        ) {
          bnfCode =
            descriptions[shortDescription] ||
            descriptions[`${shortDescription} tablets`];
          // log(
          //   `Found ${bnfCode} (${shortDescription}) for ${description}`
          // );
        } else if (otherDefs[shortDescription]) {
          bnfCode = otherDefs[shortDescription];
          //log(
          // `ALTERNATIVE Found ${bnfCode} (${shortDescription}) for ${description}`
          alternative[description] = {
            bnfCode,
            shortDescription,
          };
          //);
        } else {
          const med = description.split(' ')[0].toLowerCase();
          if (!failed.items[med])
            failed.items[med] = [{ snomedCode, description }];
          else failed.items[med].push({ snomedCode, description });
        }
      }
      if (!mapping[bnfCode]) {
        mapping[bnfCode] = [snomedCode];
      } else {
        mapping[bnfCode].push(snomedCode);
      }
    }
  );

  if (Object.keys(multiple).length > 15) {
    log(
      'There are more duplicate descriptions with different BNF codes than expected. Please check the __multiple.json file.'
    );
    process.exit();
  }
  if (Object.keys(multiple2.rest).length > 30) {
    log(
      'There are more duplicate short descriptions with different BNF codes than expected. Please check the __multiple2.json file.'
    );
    process.exit();
  }
}

async function loadHierarchyIntoMemory(fileName) {
  const outDir = fileName.split('.')[0];
  const { hierarchyJsonFile } = getFileNames(outDir);
  const content = readFileSync(join(HIER_DIR, fileName), 'utf8');
  // Parse the CSV content
  const records = parse(content, { bom: true, columns: true });
  /*
{  
  "BNF Chapter": "Gastro-Intestinal System",   "BNF Chapter Code": "01",   "BNF Section": "Dyspepsia and gastro-oesophageal reflux disease",
  "BNF Section Code": "0101",   "BNF Paragraph": "Antacids and simeticone",   "BNF Paragraph Code": "010101",   "BNF Subparagraph": "Antacids and simeticone",
  "BNF Subparagraph Code": "0101010",   "BNF Chemical Substance": "Other antacid and simeticone preparations",   "BNF Chemical Substance Code": "010101000",
  "BNF Product": "Proprietary compound preparation BNF 0101010",   "BNF Product Code": "010101000BB",   "BNF Presentation": "Indigestion mixture",
  "BNF Presentation Code": "010101000BBAJA0",
}
  */
  const mapping = {};
  records.forEach(
    ({
      'BNF Chapter': chapter,
      'BNF Chapter Code': chapterCode,
      'BNF Section': section,
      'BNF Section Code': sectionCode,
      'BNF Paragraph': paragraph,
      'BNF Paragraph Code': paragraphCode,
      'BNF Subparagraph': subparagraph,
      'BNF Subparagraph Code': subparagraphCode,
      'BNF Chemical Substance': chemicalSubstance,
      'BNF Chemical Substance Code': chemicalSubstanceCode,
      'BNF Product': product,
      'BNF Product Code': productCode,
      'BNF Presentation': presentation,
      'BNF Presentation Code': presentationCode,
    }) => {
      // Don't need prefixes in prefix hierarchy
      presentationCode = presentationCode.replace(productCode, '');
      productCode = productCode.replace(chemicalSubstanceCode, '');
      chemicalSubstanceCode = chemicalSubstanceCode.replace(
        subparagraphCode,
        ''
      );
      subparagraphCode = subparagraphCode.replace(paragraphCode, '');
      paragraphCode = paragraphCode.replace(sectionCode, '');
      sectionCode = sectionCode.replace(chapterCode, '');

      let pointer;
      if (!mapping[chapterCode]) mapping[chapterCode] = { name: chapter };
      pointer = mapping[chapterCode];
      if (!pointer[sectionCode]) pointer[sectionCode] = { name: section };
      pointer = pointer[sectionCode];
      if (!pointer[paragraphCode]) pointer[paragraphCode] = { name: paragraph };
      pointer = pointer[paragraphCode];
      if (!pointer[subparagraphCode])
        pointer[subparagraphCode] = { name: subparagraph };
      pointer = pointer[subparagraphCode];
      if (!pointer[chemicalSubstanceCode])
        pointer[chemicalSubstanceCode] = { name: chemicalSubstance };
      pointer = pointer[chemicalSubstanceCode];
      if (!pointer[productCode]) pointer[productCode] = { name: product };
      pointer = pointer[productCode];
      if (!pointer[presentationCode])
        pointer[presentationCode] = { name: presentation };
    }
  );
  writeFileSync(ensureDir(hierarchyJsonFile), JSON.stringify(mapping, null, 2));
  return outDir;
}

async function loadDataIntoMemory({ dirName }) {
  const { processedFilesDir, mappingFile, readableMappingFile } =
    getFileNames(dirName);
  if (existsSync(mappingFile) && existsSync(readableMappingFile)) {
    log(`The json files already exist so I'll move on...`);
    return dirName;
  }
  ensureDir(processedFilesDir, true);

  await loadDataIntoMemoryHelper(dirName);

  writeFileSync(
    join(processedFilesDir, '__failed.json'),
    JSON.stringify(failed, null, 2)
  );
  writeFileSync(
    join(processedFilesDir, '__multiple.json'),
    JSON.stringify(multiple, null, 2)
  );
  writeFileSync(
    join(processedFilesDir, '__multiple2.json'),
    JSON.stringify(multiple2, null, 2)
  );
  writeFileSync(
    join(processedFilesDir, '__alternative.json'),
    JSON.stringify(alternative, null, 2)
  );
  //
  log(`Mapping file loaded. It has ${Object.keys(mapping).length} rows.`);
  log('Writing the mapping data to 2 JSON files.');
  log('First is bnf-map-readable.json...');

  writeFileSync(readableMappingFile, JSON.stringify(mapping, null, 2));

  log('Now bnf-map.json...');
  writeFileSync(mappingFile, JSON.stringify(mapping));

  return dirName;
}

function compressJson(dirName) {
  const { mappingFile, mappingFileBrotli } = getFileNames(dirName);
  if (existsSync(mappingFileBrotli)) {
    log(`The brotli files already exist so I'll move on...`);
    return dirName;
  }
  log('Starting compression...');
  brotliCompress(mappingFile);
  log(`All compressed.`);
  return dirName;
}

async function upload(dirName) {
  const { mappingFile, version } = getFileNames(dirName);
  const r2Path = join('BNF', version);
  await uploadToR2(mappingFile, join(r2Path, basename(mappingFile)));
  return r2Path;
}

async function processBNFMappingFiles() {
  heading('BNF mapping files');
  const bnfLatestFile = join(FILES_DIR, 'latest.json');
  if (!existsSync(bnfLatestFile)) {
    log(
      'There should be a file called latest.json under files/bnf/. You need to run again to download the latest zip files.'
    );
    process.exit();
  }
  const latestBNF = JSON.parse(readFileSync(bnfLatestFile, 'utf8'));
  const dirName = basename(latestBNF.outDir);
  const r2Path = await loadDataIntoMemory({ dirName })
    .then(compressJson)
    .then(upload);
  recordKey('bnf-snomed-mapping', { name: dirName, r2Path });
}

async function processBNFHierarchy() {
  heading('BNF hierarchy files');

  const bnfLatestHierarchyFile = join(FILES_DIR, 'latest-hierarchy.json');
  if (!existsSync(bnfLatestHierarchyFile)) {
    log(
      'There should be a file called latest-hierarchy.json under files/bnf/. You need to run again to download the latest zip files.'
    );
    process.exit();
  }
  const latestBNF = JSON.parse(readFileSync(bnfLatestHierarchyFile, 'utf8'));
  const dirName = await loadHierarchyIntoMemory(latestBNF.fileName);

  const { hierarchyJsonFile } = getFileNames(dirName);
  log('Starting compression...');
  brotliCompress(hierarchyJsonFile);
  const r2Path = join('BNF', dirName);
  await uploadToR2(
    hierarchyJsonFile,
    join(r2Path, basename(hierarchyJsonFile))
  );
  recordKey('bnf-hierarchy', { name: dirName, r2Path });
}
async function processBNF() {
  await processBNFHierarchy();
  await processBNFMappingFiles();
}

export { processBNF };
