import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { log } from './utils.js';

/**
 * Takes a JSON file path, and compresses it with brotli to [filename].br
 * unless the brotli file already exists.
 * @param {string} fullFilePath The full file path to the json file
 */
function brotliCompress(fullFilePath) {
  const brotFile = `${fullFilePath}.br`;
  if (existsSync(brotFile)) {
    log(`The file ${brotFile} already exists so no need to compress.`);
    return;
  }
  log(`Compressing ${basename(fullFilePath)}...`);

  var child = spawnSync('brotli', ['-Z', fullFilePath], {
    // -Z means max compression (level 11)
    encoding: 'utf8',
  });
  log(`Compressed ${brotFile}`);
  if (child.error) {
    log('ERROR: ', child.error);
  }
}

export { brotliCompress };
