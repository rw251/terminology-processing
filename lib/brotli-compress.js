import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { spawnSync } from 'node:child_process';

function brotliCompress(fullFilePath) {
  const brotFile = `${fullFilePath}.br`;
  if (existsSync(brotFile)) {
    console.log(
      `> The file ${brotFile} already exists so no need to compress.`
    );
    return;
  }
  console.log(`> Compressing ${basename(fullFilePath)}...`);

  var child = spawnSync('brotli', ['-Z', fullFilePath], {
    // -Z means max compression (level 11)
    encoding: 'utf8',
  });
  console.log(`> Compressed ${brotFile}`);
  if (child.error) {
    console.log('> ERROR: ', child.error);
  }
}

export { brotliCompress };
