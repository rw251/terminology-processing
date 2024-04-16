// Loads and processes Readv2 and CTV3 dictionaries
// Assumes that the CTV3 dictionary is available as a single file dict.txt and Readv2 is
// codes.dict.txt and drugs.dict.txt. This was available from TRUD at the time of writing.

// IT IS UNLIKELY WE'LL NEED TO RUN THIS AGAIN, BUT RETAINING IN CASE BUG FIXES REQUIRED.

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { brotliCompress } from '../lib/brotli-compress.js';
import { uploadToR2 } from '../lib/cloudflare.js';
import { generateTrie, processWords } from '../lib/word-utils.js';
import { getDirName, recordKey, log } from '../lib/utils.js';
const __dirname = getDirName(import.meta.url);

const DIR = join(__dirname, 'files', 'raw');
const CTV3_DIR = join(DIR, 'CTV3', '20180401');
const READv2_DIR = join(DIR, 'Readv2', 'v20160401');
const ctv3Dir = 'CTV3-20180401';
const readv2Dir = 'Readv2-20160401';
const OUT_CTV3_DIR = join(__dirname, 'files', 'processed', ctv3Dir);
const OUT_READv2_DIR = join(__dirname, 'files', 'processed', readv2Dir);

const defsCTV3 = 'defs-ctv3.json';
const defsCTV3Readable = 'defs-ctv3-readable.json';
const relationsCTV3 = 'relations-ctv3.json';
const relsCTV3Readable = 'relations-ctv3-readable.json';
const defsReadv2 = 'defs-readv2.json';
const defsRv2Readable = 'defs-readv2-readable.json';
const relationsReadv2 = 'relations-readv2.json';
const relationsReadv2Readable = 'relations-readv2-readable.json';

function processHierarchyFile(file, defs = {}, rels = {}) {
  readFileSync(file, 'utf8')
    .split('\n')
    .map((row) => {
      const [code, description, parent] = row.trim().split('\t');
      if (!code) return;
      if (!defs[code]) defs[code] = [description];
      else defs[code].push(description);
      if (!rels[parent]) rels[parent] = {};
      rels[parent][code] = true;
    });
  return { defs, rels };
}
function processCTV3() {
  log('Loading and processing CTV3 files...');
  const { defs, rels } = processHierarchyFile(join(CTV3_DIR, 'dict.txt'));
  writeFileSync(
    join(OUT_CTV3_DIR, defsCTV3Readable),
    JSON.stringify(defs, null, 2)
  );
  writeFileSync(join(OUT_CTV3_DIR, defsCTV3), JSON.stringify(defs));
  writeFileSync(
    join(OUT_CTV3_DIR, relsCTV3Readable),
    JSON.stringify(rels, null, 2)
  );
  writeFileSync(join(OUT_CTV3_DIR, relationsCTV3), JSON.stringify(rels));
  return defs;
}
function processReadv2() {
  log('Loading and processing Readv2 non-drug files...');
  const { defs, rels } = processHierarchyFile(
    join(READv2_DIR, 'codes.dict.txt')
  );
  log('Loading and processing Readv2 drug files...');
  const result = processHierarchyFile(
    join(READv2_DIR, 'drugs.dict.txt'),
    defs,
    rels
  );
  writeFileSync(
    join(OUT_READv2_DIR, defsRv2Readable),
    JSON.stringify(result.defs, null, 2)
  );
  writeFileSync(join(OUT_READv2_DIR, defsReadv2), JSON.stringify(result.defs));
  writeFileSync(
    join(OUT_READv2_DIR, relationsReadv2Readable),
    JSON.stringify(result.rels, null, 2)
  );
  writeFileSync(
    join(OUT_READv2_DIR, relationsReadv2),
    JSON.stringify(result.rels)
  );
  return defs;
}

async function processOldDictionaries() {
  const ctv3Defs = processCTV3();
  const ctv3Definitions = Object.values(ctv3Defs).flat();
  generateTrie(ctv3Definitions, OUT_CTV3_DIR);
  processWords(ctv3Defs, OUT_CTV3_DIR);
  const readv2Defs = processReadv2();
  const readv2Definitions = Object.values(readv2Defs).flat();
  generateTrie(readv2Definitions, OUT_READv2_DIR);
  processWords(readv2Defs, OUT_READv2_DIR);

  const files = [
    { name: defsCTV3, folder: ctv3Dir, path: OUT_CTV3_DIR },
    { name: defsReadv2, folder: readv2Dir, path: OUT_READv2_DIR },
    { name: relationsCTV3, folder: ctv3Dir, path: OUT_CTV3_DIR },
    { name: relationsReadv2, folder: readv2Dir, path: OUT_READv2_DIR },
    { name: 'trie.json', folder: ctv3Dir, path: OUT_CTV3_DIR },
    { name: 'trie.json', folder: readv2Dir, path: OUT_READv2_DIR },
    { name: 'words.json', folder: ctv3Dir, path: OUT_CTV3_DIR },
    { name: 'words.json', folder: readv2Dir, path: OUT_READv2_DIR },
  ];
  for (let file of files) {
    brotliCompress(join(file.path, file.name));
    await uploadToR2(
      join(file.path, file.name),
      join(...file.folder.split('-').concat([file.name]))
    );
  }
  recordKey('readv2', {
    name: readv2Dir,
    r2Path: join(...readv2Dir.split('-')),
  });
  recordKey('ctv3', { name: ctv3Dir, r2Path: join(...ctv3Dir.split('-')) });
}

export { processOldDictionaries };
