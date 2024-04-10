import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { spawnSync } from 'node:child_process';

function brotliCompress(fullFilePath, quality = 11) {
  //compression level - 11 is max
  const brotFile = `${fullFilePath}.br`;
  if (existsSync(brotFile)) {
    console.log(
      `> The file ${brotFile} already exists so no need to compress.`
    );
    return;
  }
  console.log(`> Compressing ${basename(fullFilePath)}...`);

  var child = spawnSync('brotli', ['-Z', fullFilePath], {
    encoding: 'utf8',
  });
  console.log(`> Compressed ${brotFile}`);
  if (child.error) {
    console.log('> ERROR: ', child.error);
  }
  // else

  // const result = compress(readFileSync(fullFilePath), {
  //   mode: 1,
  //   extension: 'br',
  //   quality,
  // });
  // console.log(`> Compressed. Writing to ${brotFile}...`);
  // writeFileSync(brotFile, result);
}

export { brotliCompress };
