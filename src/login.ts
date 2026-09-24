import { config } from "dotenv";
config({ path: ".env" });

import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import readlineSync from "readline-sync";

const apiId = Number(process.env["API_ID"]);
const apiHash = String(process.env["API_HASH"]);
const session = new StringSession("");

const client = new TelegramClient(session, apiId, apiHash, {
  connectionRetries: 5,
});

(async () => {
  await client.start({
    phoneNumber: async () => readlineSync.question("Phone: "),
    password: async () =>
      readlineSync.question("2FA password: "),
    phoneCode: async () => readlineSync.question("Code: "),
    onError: (err) => console.error(err),
  });
  console.log(await client.getMe());
  console.log("Session string:", client.session.save());
})();
