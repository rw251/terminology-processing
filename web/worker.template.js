/*
Get definitions
*/
const terminology = this.name;
function log(msg) {
  console.log(`W-${terminology.toUpperCase()}> ${msg}`);
}

onmessage = (e) => {
  const { action, params } = e.data;
  const { version, words, id, stub } = params;
  switch (action) {
    case 'search':
      search(words, id);
      break;
    case 'autocomplete':
      const potentialWords = findWords(stub);
      postMessage({ msg: 'autocomplete', stub, words: potentialWords });
      break;
    default:
      log(`Incorrect action received by worker: ${action}`);
  }
};

function getChildren(code) {
  if (terminology === 'readv2') code = code.substring(0, 5);
  if (!o.rels[code]) return [];
  return Object.keys(o.rels[code]);
}

function getDescendantList(conceptId) {
  if (!o.defs[conceptId]) {
    return [];
  }
  let ans = [];
  let queue = [{ code: conceptId, level: 0 }];

  while (queue.length > 0) {
    const next = queue.pop();
    ans.push(next);
    const children = getChildren(next.code);
    queue = queue.concat(
      children.map((x) => {
        return { code: x, level: next.level + 1 };
      })
    );
  }
  const list = ans.map((x) => {
    x.def = o.defs[x.code];
    return x;
  });
  return list;
}
const exclusionTerms = [
  /\(disorder\)/i,
  /\(procedure\)/i,
  /\(substance\)/i,
  /\(observable entity\)/i,
  /\(navigational concept\)/i,
  /\(record artifact\)/i,
  /\(morphologic abnormality\)/i,
  /\(qualifier value\)/i,
  /\(situation\)/i,
  /\(disposition\)/i,
  /\(cell\)/i,
  /\(regime\/therapy\)/i,
  / level$/i,
  / syndrome$/i,
  / therapy$/i,
  / ratio$/i,
  / measurement$/i,
  /\(finding\)/i,
  /\(event\)/i,
  /serum.*concentration/i,
  /urine.*concentration/i,
  /adverse.*reaction/i,
];
function shouldExclude(definition, code) {
  const def =
    typeof definition === 'string' ? definition : definition.join(' | ');
  if (terminology === 'ctv3' && !o.medicalCodes[code]) return true;
  if (terminology === 'readv2' && !code.match(/^[a-z]/)) return true;
  return exclusionTerms.filter((x) => def.match(x)).length > 0;
}
function search(words, id) {
  const concepts = {};
  const excludedConcepts = {};
  const possibleExtraWordsObject = {};
  let message;
  let originalLength = 0;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (o.words[word]) {
      // That word exists
      const newConcepts = {};
      // For each code matching the word...
      for (let j = 0; j < o.words[word].length; j++) {
        const tempConceptId = o.words[word][j];
        // Sometimes we compress the snomed ids and need to retrieve them via a lookup
        const conceptId = o.lookup ? o.lookup[tempConceptId] : tempConceptId;
        // get the definition (is either a string, or an array of multiple defs if ctv/read)
        const definition = o.defs[conceptId];
        // Go for last in array if multiple as that is the location of the longest def;
        const singleDefinition =
          typeof definition === 'string'
            ? definition
            : definition[definition.length - 1];
        // check if we should exclude it
        if (shouldExclude(definition, conceptId)) {
          excludedConcepts[conceptId] = singleDefinition;
        } else {
          newConcepts[conceptId] = singleDefinition;
          concepts[conceptId] = singleDefinition;
        }
        getDescendantList(conceptId).forEach(({ code, def }) => {
          const singleDef = typeof def === 'string' ? def : def[def.length - 1];
          if (shouldExclude(def, code)) {
            excludedConcepts[code] = singleDef;
          } else {
            newConcepts[code] = singleDef;
            concepts[code] = singleDef;
          }
        });
        if (Object.keys(concepts).length > 10000) {
          return postMessage({
            msg: 'searchResult',
            message: 'Too many matches',
            terminology,
            id,
          });
        }
      }

      if (i === 0) {
        originalLength = Object.entries(concepts).length;
        message = `- ${originalLength} concepts matched from "${word}"`;
      }

      // unmatched words
      Object.values(newConcepts)
        .filter((conceptDefinition) => {
          // filter to those not already matching a search word
          const searchWordsAppearingInDefinition = words.filter((eachWord) => {
            return conceptDefinition.toLowerCase().indexOf(eachWord) > -1;
          });
          return searchWordsAppearingInDefinition.length === 0;
        })
        .map(
          (conceptDefinition) => conceptDefinition.toLowerCase().split(' ')[0]
        )
        .filter(
          (possibleWord) => ['product', 'generic'].indexOf(possibleWord) < 0
        )
        .forEach((possibleWord) => {
          possibleWord = possibleWord.replace(/^\*/g, '');
          possibleExtraWordsObject[possibleWord] = true;
        });
    }
  }
  const newLength = Object.keys(concepts).length;
  const formatter = new Intl.ListFormat('en', {
    style: 'long',
    type: 'conjunction',
  });
  if (newLength > originalLength) {
    message += `\n- A further ${
      newLength - originalLength
    } codes found by also searching for ${formatter.format(words.slice(1))}`;
  }
  return postMessage({
    msg: 'searchResult',
    message,
    terminology,
    concepts,
    possibleExtraWords: Object.keys(possibleExtraWordsObject),
    excludedConcepts,
    id,
  });
}

const findWords = (stub) => {
  let pointer = o.trie;
  stub
    .toLowerCase()
    .split('')
    .forEach((letter) => {
      pointer = pointer[letter];
    });
  if (!pointer) return [];
  const words = [];
  if (typeof pointer === 'string') {
    return [stub + pointer];
  }
  const queue = Object.keys(pointer)
    .map((x) => {
      if (x === '1' && pointer[x] === true) {
        words.push(stub);
        return false;
      }
      return { p: pointer[x], s: stub + x };
    })
    .filter(Boolean);
  while (queue.length > 0) {
    const { p, s } = queue.shift();
    if (p && typeof p === 'object') {
      // already there and already an object
      Object.keys(p).forEach((x) => {
        if (x === '1' && p[x] === true) words.push(s);
        else queue.push({ p: p[x], s: s + x });
      });
    } else if (p === true) {
      // already there but a boolean
      words.push(s);
    } else if (p) {
      // already there but a string
      words.push(s + p);
    } else {
      //shoultn'd get here
    }
  }
  return words;
};

const o = { medicalCodes: {} };
function findDrugCodes(code) {
  let queue = Object.keys(o.rels[code]);
  while (queue.length > 0) {
    const nextCode = queue.pop();
    if (o.rels[nextCode]) {
      Object.keys(o.rels[nextCode]).forEach((code) => {
        queue.push(code);
      });
    }
    o.medicalCodes[nextCode] = true;
  }
}

let retrieved = 0;
async function loadObject(name, r2Path, filename) {
  console.time(`FETCH:${name}`);
  log(`Starting to fetch ${name}`);
  const url = `{URL}/${r2Path.replace(/\/\//g, '/')}/${filename}`;
  const htmlStream = await fetch(url);
  console.timeEnd(`FETCH:${name}`);
  console.time(`.json():${name}`);
  o[name] = await htmlStream.json().catch((err) => {
    //json parsing error
    log(`Error parsing: ${url}`);
  });
  if (name === 'rels' && terminology === 'ctv3') {
    findDrugCodes('x00xm');
    findDrugCodes('x025Q');
  }
  retrieved++;
  postMessage({
    msg: 'loading',
    terminology,
    number: retrieved,
    total: objectsToLoad.length,
  });
  console.timeEnd(`.json():${name}`);
  if (retrieved === objectsToLoad.length) {
    postMessage({ msg: 'loaded', terminology });
  }
}

const filenames = {
  ctv3: {
    defs: 'defs-ctv3.json',
    rels: 'relations-ctv3.json',
    trie: 'trie.json',
    words: 'words.json',
  },
  readv2: {
    defs: 'defs-readv2.json',
    rels: 'relations-readv2.json',
    trie: 'trie.json',
    words: 'words.json',
  },
  snomed: {
    defs: 'defs-single.json',
    rels: 'relationships.json',
    trie: 'trie.json',
    words: 'words-hash.json',
    lookup: 'words-lookup.json',
  },
};

const objectsToLoad = Object.entries(filenames[terminology]).map(([name]) => {
  return { name, filename: filenames[terminology][name] };
});

async function loadKeys() {
  const keys = await fetch(`keys.json?v=${Math.random()}`).then((x) =>
    x.json()
  );
  objectsToLoad.forEach(({ name, filename }) => {
    loadObject(name, keys[terminology].r2Path, filename);
  });
}

loadKeys();
