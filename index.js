import inquirer from 'inquirer';
import { processOldDictionaries } from './readv2-ctv3/index.js';
import { processLatestSNOMED } from './snomed/index.js';
import { processLatestNHSDrugRefsets } from './nhs-drug-refset/index.js';
import { processLatestNHSPCDRefsets } from './nhs-pcd-refset/index.js';
import { processBNF } from './bnf/index.js';
import { downloadAndExtractLatestZips } from './lib/trud.js';

// processLatestNHSPCDRefsets();
const choices = [
  {
    name: 'Download and extract the latest zip files',
    value: downloadAndExtractLatestZips,
  },
  { name: 'Process the latest SNOMED dictionary', value: processLatestSNOMED },
  {
    name: 'Process the latest BNF to SNOMED mapping file',
    value: processBNF,
  },
  {
    name: 'Process the latest NHS drug refsets (non-drug refsets)',
    value: processLatestNHSDrugRefsets,
  },
  {
    name: 'Process the latest NHS Primary Care Domain refsets (non-drug refsets)',
    value: processLatestNHSPCDRefsets,
  },
  {
    name: 'Process the final Readv2/CTV3 dictionaries',
    value: processOldDictionaries,
  },
  { name: 'Quit', value: process.exit },
];

process.kill = () => {
  process.stdout.write('\n\n');
  console.log('Exiting... Goodbye!');
  process.exit();
};

async function askQuestion() {
  const name = 'choice';
  console.log('\n');
  inquirer
    .prompt([
      {
        type: 'list',
        name,
        message: 'What do you want to do?',
        choices,
      },
    ])
    .then(async (answers) => {
      await answers.choice();
      await askQuestion();
    })
    .catch((error) => {
      if (error.isTtyError) {
        // Prompt couldn't be rendered in the current environment
      } else {
        // Something else went wrong
        console.log(error);
      }
    });
}

askQuestion();
