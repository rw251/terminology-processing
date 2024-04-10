import { writeFileSync } from 'fs';
import { join } from 'path';

/**
 *
 * @param {*} definitions
 * @param {*} directory
 */
function processWords(definitions, directory) {
  const words = {};
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
            words[word.toLowerCase()] = [key];
          } else {
            words[word.toLowerCase()].push(key);
          }
        }
      });
  });
  console.log(
    Object.entries(words)
      .filter(([word, keys]) => {
        return word.length >= 2 && keys.length > 5000;
      })
      .map(([word, keys]) => `${word} - ${keys.length}`)
      .join('\n')
  );
  console.log('> Writing words.json...');
  writeFileSync(join(directory, `words.json`), JSON.stringify(words));
}

/**
 * Generate a trie from a list of words
 * @param {*} definitions An array of definitions
 * @param {*} directory
 * @returns
 */
function generateTrie(definitions, directory) {
  console.log('> Generating word list for trie...');
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
  console.log(`Extracted ${Object.keys(uniqueWords).length} words.`);
  const trie = {};
  console.log('> Generating trie...');
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
  console.log('> Writing trie.json...');
  writeFileSync(join(directory, `trie.json`), JSON.stringify(trie));
  return trie;
}

export { generateTrie, processWords };
