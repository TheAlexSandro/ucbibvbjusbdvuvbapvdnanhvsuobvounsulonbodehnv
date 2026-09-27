import "dotenv/config";
import express from "express";
import { Bot, type Context } from "grammy";
import { TelegramClient } from "teleproto";
import {
  NewMessage,
  NewMessageEvent,
  EditedMessage,
  EditedMessageEvent,
} from "teleproto/events/index.js";
import { StringSession } from "teleproto/sessions/index.js";
import { initDb, Database } from "./prisma/Database";
import { Cache } from "./Utils/Caches";

import { UserBotHandle } from "./Handlers/UserBotHandle";
import { BotHandle } from "./Handlers/BotHandle";

const apiId = Number(process.env["API_ID"]);
const apiHash = String(process.env["API_HASH"]);
const tgClients: TelegramClient[] = [];
const bot = new Bot(String(process.env["BOT_TOKEN"]));

let ssList: string[] = [];
let i = 1;

while (process.env[`SESSION_STRING_${i}`] !== undefined) {
  ssList.push(process.env[`SESSION_STRING_${i}`]!);
  i++;
}

const initUserbot = async (stringSession: string) => {
  const session = new StringSession(stringSession);
  const tgClient = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
    autoReconnect: true,
  });

  await tgClient.connect();
  tgClients.push(tgClient);

  tgClient.addEventHandler((event: NewMessageEvent) => {
    if (event.message.isPrivate) {
      event.client?.getMe().then((entity) => {
        const handlers = new UserBotHandle(
          event,
          tgClient,
          bot,
          tgClients,
          entity,
        );
        return handlers.handle();
      });
    } else {
      const handlers = new UserBotHandle(event, tgClient, bot, tgClients, null);
      return handlers.handle();
    }
  }, new NewMessage({}));

  tgClient.addEventHandler((event: EditedMessageEvent) => {
    if (event.message.isPrivate) {
      event.client?.getMe().then((entity) => {
        const handlers = new UserBotHandle(
          event,
          tgClient,
          bot,
          tgClients,
          entity,
        );
        return handlers.editedMessageHandle();
      });
    } else {
      const handlers = new UserBotHandle(event, tgClient, bot, tgClients, null);
      return handlers.editedMessageHandle();
    }
  }, new EditedMessage({}));

  const info = await tgClient.getMe();
  console.log(
    `CONNECTED USERBOT ${info.firstName} - ${info.username} [${Number(info.id)}]`,
  );
};

const app = express();

bot.on("message", (ctx: NonNullable<Context>) => {
  const handle = new BotHandle(bot, ctx, tgClients);
  return handle.message();
});

bot.on("callback_query", (ctx: NonNullable<Context>) => {
  const handle = new BotHandle(bot, ctx, tgClients);
  return handle.callback();
});

(async () => {
  await initDb();
  await Promise.all(ssList.map((ss) => initUserbot(ss)));
  Database.orm.public.DisabledUserBot.select("UserId")
    .all()
    .then(async (db_result) => {
      const disabledSet = new Set(
        db_result.map((row) => row.UserId.toString()),
      );

      await Promise.all(
        tgClients.map(async (client, index) => {
          try {
            const me = await client.getMe();
            const isDisabled = disabledSet.has(me.id.toString());
            if (isDisabled) {
              Cache.set(`userbot_${String(me.id)}_disabled`, true);
            }
          } catch (err) {
            console.log(`Client ${index} gagal getMe saat sync cache:`, err);
          }
        }),
      );

      console.log("Cache disabled userbot berhasil di-sync dari DB.");
    });
  bot.start({ drop_pending_updates: true });
  app.get("/ping", (req, res) => {
    return res.json({ ok: true });
  });
  app.listen(3000, () => {
    console.log("ALL SYSTEM CONNECTED.");
  });
})();
