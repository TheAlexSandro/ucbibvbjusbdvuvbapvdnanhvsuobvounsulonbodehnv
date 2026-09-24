import { config } from "dotenv";
config({ path: ".env" });

import express from "express";
import { Bot, type Context } from "grammy";
import { TelegramClient } from "teleproto";
import {
  NewMessage,
  NewMessageEvent,
  EditedMessage,
  EditedMessageEvent,
} from "teleproto/events";
import { StringSession } from "teleproto/sessions";

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
    const handlers = new UserBotHandle(event, tgClient, bot);
    return handlers.handle();
  }, new NewMessage({}));

  tgClient.addEventHandler((event: EditedMessageEvent) => {
    const handlers = new UserBotHandle(event, tgClient, bot);
    return handlers.editedMessageHandle();
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
  await Promise.all(ssList.map((ss) => initUserbot(ss)));
  bot.start({ drop_pending_updates: true });
  app.get("/ping", (req, res) => {
    return res.json({ ok: true });
  });
  app.listen(3000, () => {
    console.log("ALL SYSTEM CONNECTED.");
  });
})();
