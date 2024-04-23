import { writeFileSync } from 'fs';
import { join } from 'path';
import { log } from './utils.js';

/**
 *
 * @param {*} definitions
 * @param {*} directory
 */
function processWords(definitions, directory, lookup) {
  const words = {};
  log('Processing words...');
  Object.keys(definitions).forEach((key, i) => {
    // Can either be a code to single definition, or a code to
    // an array of definitions.
    const definition =
      typeof definitions[key] === 'string'
        ? definitions[key]
        : definitions[key].join(' ');

    definition
      .replace(/[^a-zA-Z0-9]/g, ' ')
      .split(' ')
      .forEach((word) => {
        if (
          word.length >= 2 &&
          [
            'ltd',
            'product',
            'physical',
            'object',
            'of',
            'with',
            'uk',
            'for',
            'and',
            'to',
            'in',
            'ml',
            'or',
            'by',
            'on',
            'at',
            'vi',
          ].indexOf(word) === -1
        ) {
          if (!words[word.toLowerCase()]) {
            words[word.toLowerCase()] = {};
          }
          words[word.toLowerCase()][key] = true;
        }
      });
  });
  log('Rationalising words...');
  Object.keys(words).forEach((word) => {
    words[word] = lookup
      ? Object.keys(words[word]).map((key) => lookup[key])
      : Object.keys(words[word]);
  });
  // log(
  //   Object.entries(words)
  //     .filter(([word, keys]) => {
  //       return word.length >= 2 && keys.length > 5000;
  //     })
  //     .map(([word, keys]) => `${word} - ${keys.length}`)
  //     .join('\n')
  // );
  if (lookup) {
    log('Writing words-hash.json...');
    writeFileSync(join(directory, `words-hash.json`), JSON.stringify(words));
    log('Inverting the lookup before writing...');
    const invertedLookup = {};
    Object.entries(lookup).forEach(([snomedId, hashId]) => {
      if(invertedLookup[hashId]) {
        log('ERROR with lookup. There is a duplicate hash which shouldn\'t occur');
        process.exit();
      }
      invertedLookup[hashId] = snomedId;
    })
    log('Writing words-lookup.json...');
    writeFileSync(join(directory, `words-lookup.json`), JSON.stringify(invertedLookup));
  } else {
    log('Writing words.json...');
    writeFileSync(join(directory, `words.json`), JSON.stringify(words));
  }
}

/**
 * Generate a trie from a list of words
 * @param {*} definitions An array of definitions
 * @param {*} directory
 * @returns
 */
function generateTrie(definitions, directory) {
  log('Generating word list for trie...');
  const uniqueWords = {};
  definitions.forEach((definition) => {
    definition
      .toLowerCase()
      .replace(/[^a-zA-Z0-9]/g, ' ')
      .split(' ')
      .forEach((word) => {
        if (word.length > 0) uniqueWords[word] = true;
      });
  });
  log(`Extracted ${Object.keys(uniqueWords).length} words.`);
  const trie = {};
  log('Generating trie...');
  Object.keys(uniqueWords)
    .sort()
    .forEach((word) => {
      let pointer = trie;
      const lastLetter = word.slice(-1);
      const stub = word.slice(0, -1);
      stub.split('').forEach((letter, i) => {
        if (pointer[letter] && typeof pointer[letter] === 'object') {
          // already there and already an object
          if (i === stub.length - 1) {
            pointer[letter][lastLetter] = true;
          }
        } else if (pointer[letter] === true) {
          // already there but a boolean
          pointer[letter] = { 1: true };
          if (i === stub.length - 1) {
            pointer[letter][lastLetter] = true;
          }
        } else if (pointer[letter]) {
          // already there but a string
          const val = pointer[letter];
          pointer[letter] = {};
          pointer[letter][val] = true;
          if (i === stub.length - 1) {
            pointer[letter][lastLetter] = true;
          }
        } else {
          if (i === stub.length - 1) pointer[letter] = lastLetter;
          else pointer[letter] = {};
        }
        pointer = pointer[letter];
      });
    });
  log('Writing trie.json...');
  writeFileSync(join(directory, `trie.json`), JSON.stringify(trie));
  log('trie.json written');
  return trie;
}

export { generateTrie, processWords };
