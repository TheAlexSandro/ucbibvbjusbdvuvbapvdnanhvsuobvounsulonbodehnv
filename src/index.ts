import "dotenv/config";
import express from "express";
import { Bot, type Context } from "grammy";
import { initDb, Database } from "./prisma/Database";
import { Cache } from "./Utils/Caches";
import { Utils } from "./Utils/Utils";
import { UserBotHandle } from "./Handlers/UserBotHandle";
import { BotHandle } from "./Handlers/BotHandle";
import { WorkerManager } from "./Workers/WorkerManager";
import { spawn } from "child_process";
import { Lifecycle } from "./Utils/LifeCycle";

const apiId = Number(process.env["API_ID"]);
const apiHash = String(process.env["API_HASH"]);
const workerCount = Number(process.env["WORKER_COUNT"] ?? 4);
const bot = new Bot(String(process.env["BOT_TOKEN"]));
const app = express();

const isSupervised = () =>
  Boolean(
    process.env["FLY_APP_NAME"] ||
    process.env["pm_id"] ||
    process.env["SUPERVISED"],
  );

const respawn = () => {
  spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    detached: true,
    stdio: "inherit",
    env: process.env,
  }).unref();
};

const loadSessionStrings = async (): Promise<string[]> => {
  const table = Database.orm.public.Userbots;
  await table.where({ IsActive: false }).update({ IsActive: true });
  const rows = await table.select("SessionString", "Sort", "IsUsed").all();

  return rows
    .filter((row) => row.IsUsed)
    .sort((a, b) => a.Sort - b.Sort)
    .map((row) => row.SessionString)
    .filter((s): s is string => Boolean(s));
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

  const sessionStrings = await loadSessionStrings();
  const total = sessionStrings.length;
  const connected = new Map<string, string>();
  let notified = false;

  const notifyReady = (timedOut = false) => {
    if (notified) return;
    notified = true;
    clearTimeout(readyTimer);

    const list = [...connected.values()].map((l) => `• ${l}`).join("\n");
    const pesan = timedOut
      ? `⚠️ <b>Server Online With Caution</b>\n${connected.size}/${total} tersambung setelah 90 detik. Sisanya mungkin session invalid atau terkena limit.`
      : `✅ <b>Server Online!</b>\n${total}/${total} userbot aktif.`;

    Promise.resolve(
      Utils.sendMessageToAdmin(bot, list ? `${pesan}\n\n${list}` : pesan),
    ).catch((err) => console.error("Gagal kirim notif admin:", err));
  };

  const readyTimer = setTimeout(() => notifyReady(true), 90_000);
  readyTimer.unref();

  const manager: WorkerManager = new WorkerManager({
    sessionStrings,
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
    onConnected: (ref, user) => {
      console.log(
        `CONNECTED USERBOT ${user.firstName} - ${user.username} [${ref.userId}]`,
      );

      const label = `${Utils.clearHTML(String(user.firstName ?? ref.userId))}${
        user.username ? ` (@${Utils.clearHTML(String(user.username))})` : ""
      } [<code>${ref.userId}</code>]`;
      connected.set(String(ref.userId), label);

      if (connected.size >= total) notifyReady();
    },
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

  let closing = false;

  const shutdown = (restart = false) => {
    if (closing) return;
    closing = true;
    clearInterval(syncTimer);

    const finish = () => {
      if (restart && !isSupervised()) respawn();
      process.exit(restart && isSupervised() ? 1 : 0);
    };

    bot
      .stop()
      .catch(() => {})
      .then(() => manager.shutdown())
      .catch(() => {})
      .then(() => {
        setTimeout(finish, 5000).unref();
        server.close(finish);
        server.closeAllConnections();
      });
  };

  Lifecycle.register(shutdown);
  process.once("SIGINT", () => shutdown());
  process.once("SIGTERM", () => shutdown());
};

main().catch((err) => {
  console.error("Gagal start:", err);
  process.exit(1);
});
