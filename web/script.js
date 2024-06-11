const $results = document.getElementById('results');
const $versionWrapper = document.getElementById('version-wrapper');
const $overview = document.getElementById('overview');
const $wrapper = document.querySelector('.wrapper');
const $extraTerms = document.getElementById('extra-terms');
const $descendantCodes = document.querySelector('#results tbody');
const $message = document.getElementById('message');
const $copyAll = document.getElementById('copy-all');
const $wordInput = document.getElementById('input-word');
const $toggleInactive = document.getElementById('show-inactive');
const $definitionsTable = document.getElementById('defs-table');
const $loader = document.getElementById('loader');
const $excludedCodes = document.getElementById('excluded-codes');
const $tab = document.querySelector('.tab');
const $termTab = document.getElementById('term-tab');
const $searchResult = document.querySelector(
  '.autocomplete-search-box .search-result'
);
const loader = {
  snomed: document.getElementById('snomed-loader'),
  ctv3: document.getElementById('ctv3-loader'),
  readv2: document.getElementById('readv2-loader'),
};
const version = '1.1.21';
document.querySelector(
  '.title'
).innerText = `Medication code set creator v${version}`;

const workerUrl = `/worker.js?v=${version}`;
const worker = {
  ctv3: new Worker(workerUrl, { name: 'ctv3' }),
  readv2: new Worker(workerUrl, { name: 'readv2' }),
  snomed: new Worker(workerUrl, { name: 'snomed' }),
};

const cachedResponses = {
  rxNorm: {},
  dbPedia: {},
};

function send(terminology, action, params = {}) {
  worker[terminology].postMessage({ action, params });
}

function onWorkerMessage(e) {
  const { msg, terminology } = e.data;
  switch (msg) {
    case 'autocomplete':
      const { words } = e.data;
      $searchResult.innerHTML = words
        .slice(0, 20)
        .map((x) => `<li>${x}</li>`)
        .join('');
      break;
    case 'searchResult':
      processSearchResults(e.data);
      break;
    case 'loading':
      const { number, total } = e.data;
      loader[terminology].querySelector(
        '.terminology-loader'
      ).style.backgroundImage = `linear-gradient(to right, #ffda12 0%, #ffda12 ${
        (100 * number) / total
      }%, #fff ${(100 * number) / total}%)`;
      break;
    case 'loaded':
      worker[terminology].isDone = true;
      loader[terminology].querySelector('.lds-facebook').style.visibility =
        'hidden';
      const termLoader = loader[terminology].querySelector(
        '.terminology-loader'
      );
      termLoader.innerText = `${terminology.toUpperCase()} loaded`;
      termLoader.style.backgroundImage = 'none';

      termLoader.style.backgroundColor = 'green';
      termLoader.style.color = 'white';
      termLoader.style.fontWeight = 'bold';

      if (worker.ctv3.isDone && worker.readv2.isDone && worker.snomed.isDone) {
        $loader.style.display = 'none';
        $wrapper.style.display = 'grid';
        $wordInput.style.backgroundImage = '';
        $wordInput.removeAttribute('disabled');
        $wordInput.setAttribute('placeholder', 'Enter a search term...');
        $wordInput.focus();
      }

      break;
  }
}

worker.ctv3.onmessage = onWorkerMessage;
worker.readv2.onmessage = onWorkerMessage;
worker.snomed.onmessage = onWorkerMessage;

let data;
let latestId;
let selectedTerminology = 'snomed';

function elHeight(el) {
  const styles = window.getComputedStyle(el);
  return (
    el.offsetHeight +
    parseFloat(styles['margin-top']) +
    parseFloat(styles['margin-bottom'])
  );
}
const includedExtraWords = {};
const potentialWords = {};
$extraTerms.addEventListener('click', async (e) => {
  if (e.target.dataset && e.target.dataset.word) {
    //Is it the more info button ?
    if (e.target.classList.contains('info-button')) {
      const term = e.target.dataset.word;
      const mainWord = $wordInput.value.trim().toLowerCase();
      const mainWordCapped =
        mainWord[0].toUpperCase() + mainWord.slice(1).toLowerCase();

      const promises = [];

      promises.push(
        cachedResponses.rxNorm[term] ||
          fetch(
            `https://rxnav.nlm.nih.gov/REST/approximateTerm.json?term=${term}`
          ).then((x) => x.json())
      );

      promises.push(
        cachedResponses.dbPedia[mainWord] ||
          fetch(
            `https://dbpedia.org/sparql?default-graph-uri=http://dbpedia.org&query=select%20%3Fz%20where%20%7B%20%3Fz%20dbo%3AwikiPageRedirects%20%20%3Chttp%3A%2F%2Fdbpedia.org%2Fresource%2F${mainWordCapped}%3E%20%7D&format=application/json`
          ).then((x) => x.json())
      );

      const [rxNormResponse, dbPediaResponse] = await Promise.all(promises);

      if (rxNormResponse) cachedResponses.rxNorm[term] = rxNormResponse;
      if (dbPediaResponse) cachedResponses.dbPedia[mainWord] = dbPediaResponse;

      const msg = [];

      if (
        dbPediaResponse &&
        dbPediaResponse.results &&
        dbPediaResponse.results.bindings &&
        dbPediaResponse.results.bindings[0] &&
        dbPediaResponse.results.bindings[0].z &&
        dbPediaResponse.results.bindings[0].z.value &&
        dbPediaResponse.results.bindings
          .map((x) =>
            x.z.value.split('/').reverse()[0].split('_').join(' ').toLowerCase()
          )
          .indexOf(term.toLowerCase()) > -1
      ) {
        msg.push(`${term} redirects to ${mainWord} on wikipedia`);
      }
      if (
        rxNormResponse &&
        rxNormResponse.approximateGroup &&
        rxNormResponse.approximateGroup.candidate
      ) {
        const possibleMatches = rxNormResponse.approximateGroup.candidate
          .map((x) => x.name || false)
          .filter(
            (x) =>
              x &&
              x.toLowerCase().indexOf($wordInput.value.trim().toLowerCase()) >
                -1
          );
        if (possibleMatches.length > 0) {
          msg.push(`RXNorm contains: ${possibleMatches[0]}`);
        }
      }

      if (msg.length > 0) {
        const el = document.createElement('div');
        el.innerText = msg.join(' / ');
        e.target.parentElement.parentElement.after(el);
      } else {
        window.open(
          `https://www.google.com/search?q=${e.target.dataset.word}`,
          '_blank'
        );
      }
    } else {
      if (e.target.classList.contains('included')) {
        // removing
        delete includedExtraWords[e.target.dataset.word];
        e.target.classList.remove('included');
        e.target.innerText = 'Include';
      } else {
        includedExtraWords[e.target.dataset.word] = true;
        e.target.classList.add('included');
        e.target.innerText = 'Remove';
      }
      search();
    }
  }
});

function displayExtraWords(words) {
  $extraTerms.innerHTML = Object.keys(includedExtraWords)
    .concat(words.filter((x) => !includedExtraWords[x]))
    .map(
      (word) =>
        `<div class="potential-word">${word} <div><button data-word="${word}" class="info-button">More info</button><button data-word="${word}" class="${
          includedExtraWords[word] ? 'included' : ''
        }">${
          includedExtraWords[word] ? 'Exclude' : 'Include'
        }</button></div></div>`
    )
    .join('');
}

function processSearchResults({
  terminology,
  concepts,
  possibleExtraWords,
  message,
  excludedConcepts,
  id,
}) {
  if (id !== latestId) return;
  data[terminology] = {
    concepts,
    message,
    excludedConcepts,
  };
  if (possibleExtraWords) {
    possibleExtraWords.forEach((word) => {
      if (data.possibleExtraWords.indexOf(word) < 0) {
        data.possibleExtraWords.push(word);
      }
    });
  }
  if (terminology === selectedTerminology) {
    displayResults();
  }
}

function displayResults() {
  if (data[selectedTerminology].concepts) {
    displayExtraWords(data.possibleExtraWords);
    const originalLength = Object.entries(
      data[selectedTerminology].concepts
    ).length;

    const items = Object.entries(data[selectedTerminology].concepts);
    $message.innerText = data[selectedTerminology].message || `No matches`;
    $descendantCodes.innerHTML = items
      .map(([code, definition]) => {
        return `<tr><td>${code}</td><td>${definition}</td></tr>`;
      })
      .join('');
    document.querySelector('.scrollable-defs').style.height = `${
      window.innerHeight - elHeight($termTab) - 36 // 36 = header
    }px`;
    data[selectedTerminology].data = items
      .map(([code, definition]) => {
        return `${code}\t${definition}`;
      })
      .join('\n');

    // Excluded codes
    const excludedItems = Object.entries(
      data[selectedTerminology].excludedConcepts
    );
    if (excludedItems.length > 0) {
      $excludedCodes.innerHTML = excludedItems
        .map(([code, definition]) => `<div>${code}: ${definition}</div>`)
        .join('');
    } else {
      $excludedCodes.innerHTML = '';
    }

    $copyAll.removeAttribute('disabled');
  } else {
    $copyAll.setAttribute('disabled', '');
    $message.innerText =
      (data && data.snomed && data.snomed.message) || `No matches`;
    displayExtraWords([]);
    $descendantCodes.innerHTML = '';
  }
}

function search(mainWord = $wordInput.value.trim().toLowerCase()) {
  latestId = Math.random();
  data = { ctv3: {}, snomed: {}, readv2: {}, possibleExtraWords: [] };
  const words = [mainWord].concat(Object.keys(includedExtraWords));
  send('snomed', 'search', { words, id: latestId });
  send('ctv3', 'search', { words, id: latestId });
  send('readv2', 'search', { words, id: latestId });
}

$wordInput.addEventListener('input', (e) => {
  const word = $wordInput.value.trim().toLowerCase();
  if (word.length > 1) {
    send('snomed', 'autocomplete', { stub: word });
    search(word);
  } else {
    $searchResult.innerHTML = '';
  }
});

$wordInput.addEventListener('keydown', (event) => {
  const callback = {
    Enter: () => {
      const currentlyHighlighted = $searchResult.querySelector('.highlighted');
      if (!currentlyHighlighted) {
        // do nothing
      } else {
        const word = currentlyHighlighted.innerText;
        if (word.length > 1) {
          $wordInput.value = word;
          search(word);
          $searchResult.innerHTML = '';
        }
      }
    },
    ArrowUp: () => {
      event.preventDefault();
      const currentlyHighlighted = $searchResult.querySelector('.highlighted');
      if (!currentlyHighlighted) {
        if ($searchResult.lastChild)
          $searchResult.lastChild.classList.add('highlighted');
      } else {
        const children = $searchResult.children;
        const index = [...children].indexOf(currentlyHighlighted);
        const nextIndex = (index - 1 + children.length) % children.length;
        children[nextIndex].classList.add('highlighted');
        currentlyHighlighted.classList.remove('highlighted');
      }
    },
    ArrowDown: () => {
      event.preventDefault();
      const currentlyHighlighted = $searchResult.querySelector('.highlighted');
      if (!currentlyHighlighted) {
        if ($searchResult.firstChild)
          $searchResult.firstChild.classList.add('highlighted');
      } else {
        const children = $searchResult.children;
        const index = [...children].indexOf(currentlyHighlighted);
        const nextIndex = (index + 1) % children.length;
        children[nextIndex].classList.add('highlighted');
        currentlyHighlighted.classList.remove('highlighted');
      }
    },
  }[event.key];
  callback?.();
});

$searchResult.addEventListener('click', (e) => {
  const node = e.target;
  if (node && node.tagName.toLowerCase() === 'li') {
    const word = node.innerText;
    if (word.length > 1) {
      $wordInput.value = word;
      search(word);
      $searchResult.innerHTML = '';
    }
    e.stopPropagation();
  }
});

document.body.addEventListener('click', () => {
  $searchResult.innerHTML = '';
});

$copyAll.addEventListener('click', async () => {
  const now = new Date();
  $copyAll.setAttribute('disabled', '');
  $copyAll.innerText = 'Copying...';
  // Copy the text inside the text field
  await navigator.clipboard.writeText(data[selectedTerminology].data);

  const diff = new Date() - now;
  // var newWin = window.open('https://code-set-comparison.rw251.com/');
  setTimeout(() => {
    $copyAll.removeAttribute('disabled', '');
    $copyAll.innerText = 'Copied!';
    // newWin.body.style.backgroundColor = 'blue';
    setTimeout(() => {
      $copyAll.innerText = 'Copy all';
    }, 2000);
  }, Math.max(0, 500 - diff));
});

function showTerminology(terminology, element) {
  document.querySelectorAll('#results .tablinks').forEach((el) => {
    el.classList.remove('active');
  });
  selectedTerminology = terminology.toLowerCase();
  if (data && data[selectedTerminology]) displayResults();
  element.classList.add('active');
}
