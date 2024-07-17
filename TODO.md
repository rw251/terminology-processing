# TODO

- EMIS?
- including hyphenated terms
  - Examples
    - Chlordiazepoxide leads to suggestion of Limbitrol-5 - but here I think we should just match limbitrol
    - Aspirin lead to suggestion of nu-seals - would want to search for nu and seals
- the extra terms jump around if you include/exclude - also the width of the button changes
- consider service worker to ensure big files are cached
- doesn't currently find possible extra words in the synonyms of read codes
- search for multiple words e.g. Sodium hydroxybutyrate, or Sodium oxybate
- for readcodes if head definition (00) is matched then disregard all synonyms (11, 12 etc.)
- Issue with 371280009 (Parenteral magnesium sulfate (product)) but also has a synonym of (Parenteral form phenobarbital). These are different drugs.
- As a side note, don't include "parenteral" as a possible drug name
- dormonoct not found for Loprazolam when searching rxnorm or dbpedia - need a 3rd search?
- also Miprosed not found for midazolam.
- also Ozalin not found for midazolam
- also epistatus not found for midazolam
- similar but Durophet i guess will redirect to "amphetamine and dexamphetamine"

- Things to exclude:

  - History of amphetamine misuse
  - History of amphetamine misuse
  - Dexamfetamine maintenance
  - Cocaine and amphetamine regulated transcript peptide level
  - Urine amphetamine positive
  - Urine amphetamine negative
  - Plasma cocaine and amphetamine regulated transcript peptide level

- Quicker way to reset everything
- Better checking e.g. lookup dbpedia for word and whitelist the terms. Then do checks for each term via rxnorm and cache.

## DONE

- List of exclusion terms
- more exclusions for read/ctv3
  - poisoning$
  - poisoning of undetermined intent$
  - allergy$
  - overdose$
  - overdose of undetermined intent$
  - OR just do it based on first letter for Read code, and ?? for ctv3
- height of scrollable area needs updating better
- Add Read and CTV3 searching as well
  e.g. to find Dozine from Chlorpromazine
- avoid extra words like \*zileze (if search for Zopiclone) - strip the "\*" and deduplicate
- If the RXNorm thing fails, then can lookup with dbpedia like this
