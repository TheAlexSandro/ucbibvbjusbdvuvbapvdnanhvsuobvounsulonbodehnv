import "dotenv/config";
import express from "express";
import { Bot, type Context } from "grammy";
import { Api, TelegramClient } from "teleproto";
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
import { UserBots } from "./Utils/UserBots";

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

const userInfos: Api.User[] = [];
const initUserbot = async (stringSession: string, idx: number) => {
  const session = new StringSession(stringSession);
  const tgClient = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
    autoReconnect: true,
  });

  await tgClient.connect();

  const me = (await tgClient.getMe()) as Api.User;
  tgClients[idx] = tgClient;
  userInfos[idx] = me;

  tgClient.addEventHandler((event: NewMessageEvent) => {
    return new UserBotHandle(event, tgClient, bot, tgClients, me).handle();
  }, new NewMessage({}));

  tgClient.addEventHandler((event: EditedMessageEvent) => {
    return new UserBotHandle(
      event,
      tgClient,
      bot,
      tgClients,
      me,
    ).editedMessageHandle();
  }, new EditedMessage({}));

  console.log(`CONNECTED USERBOT ${me.firstName} - ${me.username} [${me.id}]`);
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
  await Promise.all(ssList.map((ss, idx) => initUserbot(ss, idx)));

  Database.orm.public.DisabledUserBot.select("UserId")
    .all()
    .then(async (db_result) => {
      const disabledSet = new Set(
        db_result.map((row) => row.UserId.toString()),
      );
      userInfos.forEach((me) => {
        if (disabledSet.has(String(me.id))) {
          Cache.set(`userbot_${String(me.id)}_disabled`, true);
        }
      });

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
