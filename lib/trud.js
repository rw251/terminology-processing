import { createWriteStream, readdirSync, existsSync, createReadStream, writeFileSync } from "fs";
import { join, basename } from "path";
import { Readable } from "stream";
import { finished } from "stream/promises";
import unzip from "unzip-stream";
import "dotenv/config";
import { ensureDir, getDirName, heading, log } from "./utils.js";

const __dirname = getDirName(import.meta.url);

let Cookie;

/**
 * Attempts to log in to TRUD and save the session cookie
 */
async function login() {
  if (Cookie) return;
  const email = process.env.email;
  const password = process.env.password;

  if (!email) {
    log("Need email=xxx in the .env file");
    process.exit();
  }
  if (!password) {
    log("Need password=xxx in the .env file");
    process.exit();
  }

  console.log("> Logging in to TRUD...");

  // Get initial session id by going to the login page

  const loginPage = await fetch("https://isd.digital.nhs.uk/trud/users/guest/filters/0/login/form");
  const sessionIdCookie = loginPage.headers
    .getSetCookie()
    .filter((x) => x.indexOf("JSESSIONID") > -1)[0]
    .match(/JSESSIONID=([^ ;]+);/)[0];

  const csrfToken = (await loginPage.text()).match(/_csrf" *value="([^"]+)"/)[1];

  const result = await fetch("https://isd.digital.nhs.uk/trud/security/j_spring_security_check", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: sessionIdCookie,
    },
    redirect: "manual",
    body: new URLSearchParams({
      _csrf: csrfToken,
      username: email,
      password: password,
      commit: "",
    }),
  });
  const cookies = result.headers.getSetCookie();
  const cookie = cookies
    .filter((x) => x.indexOf("JSESSIONID") > -1)[0]
    .match(/JSESSIONID=([^ ;]+);/)[0];
  console.log("> Logged in, and cookie cached.");
  Cookie = cookie;
}

const baseTrudUrl = "https://isd.digital.nhs.uk/trud/users/authenticated/filters/0/categories/";

/**
 * Finds all recent downloads of a particular item from TRUD
 * @param {string} item The partial url of the item to search for
 * @returns {Array} An array of urls for the downloads
 */
async function getTrudUrls(item) {
  await login();
  const response = await fetch(`${baseTrudUrl}${item}`, {
    headers: { Cookie },
  });
  const html = await response.text();
  const urls = html.match(/https:\/\/isd.digital.nhs.uk\/download[^"]+(?:")/g).map((zipFileUrl) => {
    const [, zipFileName] = zipFileUrl.match(/\/([^/]+.zip)/);
    return { zipFileUrl, zipFileName };
  });

  return { urls };
}

async function downloadFile(url, filePath) {
  const stream = createWriteStream(filePath);
  const { body } = await fetch(url, { headers: { Cookie } });
  await finished(Readable.fromWeb(body).pipe(stream));
  log(`File downloaded.`);
}
async function downloadTRUDFile(url, filePath) {
  await login();
  await downloadFile(url, filePath);
}

const TRUD = {
  nhsPcdRefsets: {
    name: "NHS PCD refsest",
    url: "8/items/659/releases",
    directory: ensureDir(join(__dirname, "..", "files", "nhs-pcd-refsets")),
    zipFileRegex: [/full.+content.+refset_simple/, /full.+sct2_description/],
  },
  snomedCodes: {
    name: "SNOMED codes",
    url: "26/items/101/releases",
    directory: ensureDir(join(__dirname, "..", "files", "snomed", "main")),
    zipFileRegex: [/full.+sct2_description/, /full.+sct2_relationship_/],
  },
  snomedDrugCodes: {
    name: "SNOMED dm+d codes",
    url: "26/items/105/releases",
    directory: ensureDir(join(__dirname, "..", "files", "snomed", "drugs")),
    zipFileRegex: [
      /full.+content.+refset_simple/,
      /full.+sct2_description/,
      /full.+sct2_relationship_/,
    ],
  },
};

function fileDirectoryPaths(directoryPath) {
  const ZIP_DIR = ensureDir(join(directoryPath, "zip"), true);
  const RAW_DIR = ensureDir(join(directoryPath, "raw"), true);
  return { ZIP_DIR, RAW_DIR };
}

async function extractDataFromZip(zipFilePath, zipFileRegexArray, outDir, isDontExtractPath) {
  log(`Extracting files from the zip...`);
  let toUnzip = 0;
  let unzipped = 0;
  let isRead = false;
  await new Promise((resolve) => {
    createReadStream(zipFilePath)
      .pipe(unzip.Parse())
      .on("entry", function (entry) {
        if (zipFileRegexArray.filter((regex) => entry.path.toLowerCase().match(regex)).length > 0) {
          log(`Extracting ${isDontExtractPath ? basename(entry.path) : entry.path}...`);
          toUnzip++;
          const outputFilePath = join(
            outDir,
            isDontExtractPath ? basename(entry.path) : entry.path
          );
          const outStream = createWriteStream(ensureDir(outputFilePath));
          outStream.on("finish", () => {
            log(`Extracted ${isDontExtractPath ? basename(entry.path) : entry.path}.`);
            unzipped++;
            if (isRead && toUnzip === unzipped) {
              return resolve();
            }
          });
          entry.pipe(outStream);
        } else {
          entry.autodrain();
        }
      })
      .on("end", () => {
        log(`Finished reading zip file.`);
        isRead = true;
        if (toUnzip === unzipped) {
          return resolve();
        }
      });
  });
  log(`${unzipped} files extracted.`);
}

async function downloadAndExtractTRUDfiles() {
  heading("TRUD files");
  await login();
  for (let { url, directory, name, zipFileRegex } of Object.values(TRUD)) {
    heading(name);
    // 1. Get URLs and file folders
    const { ZIP_DIR, RAW_DIR } = fileDirectoryPaths(directory);
    const existingFiles = readdirSync(ZIP_DIR);
    const { urls } = await getTrudUrls(url);

    // 2. Download zip files if not already
    // for now let's just do the most recent
    const { zipFileUrl, zipFileName } = urls[0];
    if (existingFiles.indexOf(zipFileName) > -1) {
      log(`The latest zip file for '${name}' already exists so no need to download again.`);
    } else {
      log(`The latest zip file for '${name}' is not stored locally. Downloading...`);
      const outputFile = join(ZIP_DIR, zipFileName);
      await downloadTRUDFile(zipFileUrl, outputFile);
    }

    // 3. Extract zips if not already
    const dirName = zipFileName.replace(".zip", "");
    const file = join(ZIP_DIR, zipFileName);
    const outDir = join(RAW_DIR, dirName);
    writeFileSync(join(directory, "latest.json"), JSON.stringify({ zipFileName, outDir }));
    if (existsSync(outDir)) {
      log(`The directory ${outDir} already exists, so I'm not unzipping.`);
    } else {
      log(`The directory ${outDir} does not yet exist. Creating...`);
      ensureDir(outDir, true);
      await extractDataFromZip(file, zipFileRegex, outDir);
    }
  }
}

async function downloadAndExtractBNFFiles() {
  heading("BNF files");
  const BNF_DIR = ensureDir(join(__dirname, "..", "files", "bnf"), true);
  const ZIP_DIR = ensureDir(join(BNF_DIR, "zip"), true);
  const RAW_DIR = ensureDir(join(BNF_DIR, "raw"), true);
  const HIER_DIR = ensureDir(join(RAW_DIR, "hierarchy"), true);

  // First do hierarchy check
  const hierarchyFiles = readdirSync(HIER_DIR).filter((x) => x.indexOf("Hierarchy") > -1);
  if (!hierarchyFiles || hierarchyFiles.length === 0) {
    log(
      "No BNF hierarchy files available, go here https://applications.nhsbsa.nhs.uk/infosystems/data/showDataSelector.do?reportId=126 do the captcha as a guest and download the latest BNF file to files/bnf/raw/hierarchy/BNF-Hierarchy-YYYYMMDD.csv"
    );
    process.exit();
  } else {
    const { fileName, dateString, date } = hierarchyFiles
      .map((fileName) => {
        const [, , dateString] = fileName.replace(".csv", "").split("-");
        if (!dateString.match(/^[0-9]{8}$/)) {
          log("There is a BNF hierarchy file that is not of the format BNF-Hierarchy-YYYYMMDD.csv");
          process.exit();
        }
        const date = new Date(
          +dateString.substring(0, 4),
          +dateString.substring(4, 6) - 1,
          +dateString.substring(6, 8)
        );
        return { fileName, dateString, date };
      })
      .sort((a, b) => b.date - a.date)[0]; //sort on date, take most recent
    const currentYearMonth = `${new Date().getFullYear()}${`0${new Date().getMonth() + 1}`.slice(
      -2
    )}`;

    if (dateString.indexOf(currentYearMonth) === 0) {
      log("Already got the latest BNF hierarchy.");
    } else {
      log(
        `Most recent BNF hierarchy data is from ${date
          .toISOString()
          .substring(
            0,
            10
          )}. The data might be released each month so go here https://applications.nhsbsa.nhs.uk/infosystems/data/showDataSelector.do?reportId=126 do the captcha as a guest and download the latest BNF file to files/bnf/raw/hierarchy/BNF-Hierarchy-YYYYMMDD.csv if different.`
      );
    }
    writeFileSync(join(BNF_DIR, "latest-hierarchy.json"), JSON.stringify({ fileName }));
  }

  const response = await fetch(
    "https://www.nhsbsa.nhs.uk/prescription-data/understanding-our-data/bnf-snomed-mapping"
  );
  const html = await response.text();
  const urls = html.match(/\/sites\/default\/files\/[0-9-]+\/BNF[^"]+zip/g).map((zipFileUrl) => {
    const [, zipFileNameRaw] = zipFileUrl.match(/\/([^/]+.zip)/);
    const zipFileName = zipFileNameRaw.replace(/%20/g, "-").replace(/_[0-9].zip/, ".zip");
    zipFileUrl = `https://www.nhsbsa.nhs.uk${zipFileUrl}`;
    return { zipFileUrl, zipFileName };
  });

  const existingFiles = readdirSync(ZIP_DIR);
  const { zipFileUrl, zipFileName } = urls[0];
  if (existingFiles.indexOf(zipFileName) > -1) {
    log(`The latest zip file for 'BNF mapping' already exists so no need to download again.`);
  } else {
    log(`The latest zip file for 'BNF mapping' is not stored locally. Downloading...`);
    const outputFile = join(ZIP_DIR, zipFileName);
    await downloadFile(zipFileUrl, outputFile);
  }

  // 3. Extract zips if not already
  const dirName = zipFileName.replace(".zip", "");
  const file = join(ZIP_DIR, zipFileName);
  const outDir = join(RAW_DIR, dirName);
  writeFileSync(join(BNF_DIR, "latest.json"), JSON.stringify({ zipFileName, outDir }));
  if (existsSync(outDir)) {
    log(`The directory ${outDir} already exists, so I'm not unzipping.`);
  } else {
    log(`The directory ${outDir} does not yet exist. Creating...`);
    ensureDir(outDir, true);
    await extractDataFromZip(file, [/xlsx/], outDir, true);
  }
}

async function downloadAndExtractLatestZips() {
  await downloadAndExtractBNFFiles();
  await downloadAndExtractTRUDfiles();
}

export { downloadAndExtractLatestZips };
