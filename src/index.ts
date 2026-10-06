import "dotenv/config";
import express from "express";
import { Bot, type Context } from "grammy";
import { initDb, Database } from "./prisma/Database";
import { Cache } from "./Utils/Caches";
import { Utils } from "./Utils/Utils";
import { UserBotHandle } from "./Handlers/UserBotHandle";
import { BotHandle } from "./Handlers/BotHandle";
import { WorkerManager } from "./Workers/WorkerManager";

const apiId = Number(process.env["API_ID"]);
const apiHash = String(process.env["API_HASH"]);
const workerCount = Number(process.env["WORKER_COUNT"] ?? 4);
const bot = new Bot(String(process.env["BOT_TOKEN"]));
const app = express();

const loadSessionStrings = (): string[] => {
  const list: string[] = [];
  for (let i = 1; process.env[`SESSION_STRING_${i}`] !== undefined; i++) {
    list.push(process.env[`SESSION_STRING_${i}`]!);
  }
  return list;
};

const syncDisabledFromDb = async () => {
  const rows = await Database.orm.public.DisabledUserBot.select("UserId").all();
  rows.forEach((row) =>
    Cache.set(`userbot_${row.UserId.toString()}_disabled`, true),
  );
  console.log("Cache disabled userbot berhasil di-sync dari DB.");
};

const main = async () => {
  await initDb();
  await syncDisabledFromDb();

  const manager: WorkerManager = new WorkerManager({
    sessionStrings: loadSessionStrings(),
    apiId,
    apiHash,
    workerCount,
    mafiaBotId: String(process.env["MAFIA_BOT_ID"]),
    trueMafia: String(process.env["TRUE_MAFIA"]),
    onMessage: (ref, payload) =>
      new UserBotHandle(payload, ref, manager, bot).handle(),
    onEditedMessage: (ref, payload) =>
      new UserBotHandle(payload, ref, manager, bot).editedMessageHandle(),
    onJoinFailed: (ref, user) =>
      Utils.sendMessageToAdmin(
        bot,
        `⚠️ <b>Perhatian!</b>\n<a href='tg://user?id=${Number(ref.userId)}'>${user?.fullName ?? ref.userId}</a> gagal bergabung, userbot mungkin dibatasi di grup atau terkena limit.`,
      ),
    onConnected: (ref, user) =>
      console.log(
        `CONNECTED USERBOT ${user.firstName} - ${user.username} [${ref.userId}]`,
      ),
  });

  bot.on("message", (ctx: NonNullable<Context>) =>
    new BotHandle(bot, ctx, manager).message(),
  );
  bot.on("callback_query", (ctx: NonNullable<Context>) =>
    new BotHandle(bot, ctx, manager).callback(),
  );

  const syncTimer = setInterval(() => {
    manager.syncState({
      groupTarget: String(Cache.get(`groupTarget`) ?? ""),
      joinMode: String(Cache.get(`join`) ?? ""),
      disabledIds: manager
        .getUsers()
        .filter((u) => Cache.get(`userbot_${u.id}_disabled`))
        .map((u) => u.id),
      registrationHandled: Boolean(Cache.get(`registrationHandled`)),
    });
  }, 200);

  bot.start({ drop_pending_updates: true }).catch((err) => {
    console.error("Bot berhenti dengan error:", err);
  });

  app.get("/ping", (_req, res) => res.json({ ok: true }));
  app.get("/", (_req, res) => res.json({ ok: true }));
  const server = app.listen(3000, "0.0.0.0", () => {
    console.log("ALL SYSTEM CONNECTED.");
  });

  const shutdown = async () => {
    clearInterval(syncTimer);
    server.close();
    await bot.stop().catch(() => {});
    await manager.shutdown();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

main().catch((err) => {
  console.error("Gagal start:", err);
  process.exit(1);
});
