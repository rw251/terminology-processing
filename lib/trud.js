import fs from 'fs';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import 'dotenv/config';

let Cookie;

/**
 * Attempts to log in to TRUD and save the session cookie
 * @returns null
 */
async function login() {
  if (Cookie) return;
  const email = process.env.email;
  const password = process.env.password;

  if (!email) {
    console.log('Need email=xxx in the .env file');
    process.exit();
  }
  if (!password) {
    console.log('Need password=xxx in the .env file');
    process.exit();
  }

  console.log('> Logging in to TRUD...');
  const result = await fetch(
    'https://isd.digital.nhs.uk/trud/security/j_spring_security_check',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      redirect: 'manual',
      body: new URLSearchParams({
        j_username: email,
        j_password: password,
        commit: 'LOG+IN',
      }),
    }
  );
  const cookies = result.headers.getSetCookie();
  const cookie = cookies.filter((x) => x.indexOf('JSESSIONID') > -1)[0];
  console.log('> Logged in, and cookie cached.');
  Cookie = cookie;
}

async function getLatestDrugRefsetUrl() {
  await login();
  const response = await fetch(
    'https://isd.digital.nhs.uk/trud/users/authenticated/filters/0/categories/26/items/105/releases?source=summary',
    { headers: { Cookie } }
  );
  const html = await response.text();
  const downloads = html.match(
    /href="(https:\/\/isd.digital.nhs.uk\/download[^"]+)"/
  );
  const latest = downloads[1];
  return latest;
}

async function downloadFile(url, filePath) {
  await login();

  const stream = fs.createWriteStream(filePath);
  const { body } = await fetch(url, { headers: { Cookie } });
  await finished(Readable.fromWeb(body).pipe(stream));
  console.log(`> File downloaded.`);
}

export { getLatestDrugRefsetUrl, downloadFile };
