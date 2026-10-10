import { Bot, Context, InputFile } from "grammy";
import { Utils } from "../Utils/Utils";
import type { WorkerManager } from "../Workers/WorkerManager";
import { markup, btn } from "../Utils/Buttons";
import { Cache } from "../Utils/Caches";
import { Database } from "../prisma/Database";
import { UserBots } from "../Utils/UserBots";
import fs from "fs/promises";
import { Api, TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import { Lifecycle } from "../Utils/LifeCycle";

const PERMS = [
  ["CanAddGroup", "Can Add Group"],
  ["CanManageGroup", "Can Manage Group"],
  ["CanGetRole", "Can Get Role"],
  ["CanUseNext", "Can Use Next"],
  ["CanStartSmode", "Can Start Smode"],
  ["CanManageSmode", "Can Manage Smode"],
  ["CanManageUbot", "Can Manage Ubot"],
  ["CanUseReset", "Can Use Reset"],
  ["CanPromoteUser", "Can Promote User"],
  ["CanViewLog", "Can View Log"],
  ["CanManageLog", "Can Manage Log"],
  ["CanLogin", "Can Login"],
  ["CanManageServer", "Can Manage Server"],
] as const;
type PermKey = (typeof PERMS)[number][0];
type PromoteDraft = {
  target: string;
  perms: Partial<Record<PermKey, boolean>>;
};
type LoginResult = {
  status: "saved" | "duplicate";
  userId: string;
  fullName: string;
  username: string | null;
};
const loginClients = new Map<string, TelegramClient>();

export class BotHandle {
  bot: Bot;
  ctx: Context;
  manager: WorkerManager;

  constructor(bot: Bot, ctx: Context, manager: WorkerManager) {
    this.bot = bot;
    this.ctx = ctx;
    this.manager = manager;
  }

  private dropLoginClient(chatId: string): Promise<void> {
    const c = loginClients.get(chatId);
    loginClients.delete(chatId);
    Cache.del(`sessionLogin_${chatId}`);
    Cache.del(`sessionVerifyCode_${chatId}`);
    Cache.del(`sessionVerifyPass_${chatId}`);
    Cache.del(`phoneHash_${chatId}`);

    return c ? c.disconnect().catch(() => {}) : Promise.resolve();
  }

  private saveLogin(chatId: string, digits: string): Promise<LoginResult> {
    const client = loginClients.get(chatId)!;
    let info: Omit<LoginResult, "status"> = {
      userId: "",
      fullName: "",
      username: null,
    };
    let sessionString = "";

    return client
      .getMe()
      .then((me: any) => {
        info = {
          userId: String(me.id),
          fullName:
            [me.firstName, me.lastName].filter(Boolean).join(" ") ||
            String(me.id),
          username: me.username ? String(me.username) : null,
        };
        sessionString = client.session.save() as unknown as string;
        return this.dropLoginClient(chatId);
      })
      .then(() =>
        Database.orm.public.Userbots.where({ UserId: info.userId }).first(),
      )
      .then((dup): LoginResult | PromiseLike<LoginResult> => {
        if (dup) return { status: "duplicate", ...info };

        return Database.orm.public.Userbots.select("Sort")
          .all()
          .then((rows) => {
            const sort =
              rows.reduce((m, r) => Math.max(m, Number(r.Sort)), 0) + 1;

            return Database.orm.public.Userbots.create({
              UserId: info.userId,
              Phone: digits,
              Sort: sort,
              SessionString: sessionString,
              IsActive: false,
            });
          })
          .then(() => ({ status: "saved" as const, ...info }));
      });
  }

  private finishLogin(
    chatId: string,
    digits: string,
    edit: (text: string, extra?: object) => Promise<unknown>,
  ): Promise<unknown> {
    return this.saveLogin(chatId, digits).then((r) => {
      const info =
        `\n\n👤 <b>${Utils.clearHTML(r.fullName)}</b>` +
        `\n🆔 <code>${r.userId}</code>` +
        `\n🔗 ${r.username ? `@${Utils.clearHTML(r.username)}` : "-"}`;

      if (r.status === "duplicate")
        return edit(
          `⚠️ <b>Sudah Terdaftar!</b>\nAkun ini sudah ada, session baru tidak disimpan.${info}`,
        );

      return edit(
        `✅ <b>Berhasil Masuk!</b>${info}\n\nRestart server diperlukan untuk menerapkan perubahan, restart sekarang?`,
        {
          reply_markup: markup.inlineKeyboard([
            [btn.text(`⏺️ Restart Sekarang`, `server_restart`)],
          ]),
        },
      );
    });
  }

  private buildPromoteKeyboard(
    admin: Record<PermKey, boolean>,
    target: string,
    perms: Partial<Record<PermKey, boolean>>,
  ) {
    const keyb = PERMS.map(([key, label]) => [
      btn.text(
        `${admin[key] ? "" : "🔒 "}${label} ${perms[key] ? "✅" : "❌"}`,
        `admin_tgl:${key}_${target}`,
      ),
    ]);
    keyb.push([
      btn.text(`❌ Batal`, `admin_return_none`),
      btn.text(`Angkat ➡️`, `admin_promote_${target}`),
    ]);
    return keyb;
  }

  private static readonly ROLES = [
    { emoji: "🕵️‍♂️", label: "Detective", cacheKey: "afkmodeDet", action: "Det" },
    { emoji: "💃", label: "Hooker", cacheKey: "afkmodeHook", action: "Hook" },
    { emoji: "🔪", label: "Maniac", cacheKey: "afkmodeMani", action: "Mani" },
    { emoji: "🎅", label: "Santa", cacheKey: "afkmodeSanta", action: "Santa" },
    {
      emoji: "🤵🏻",
      label: "Don (cek)",
      cacheKey: "afkmodeDonCh",
      action: "DonCh",
    },
  ];

  private buildRoleButtons(callbackPrefix: string): any[] {
    return BotHandle.ROLES.map((role) => [
      btn.text(
        `${role.emoji} ${role.label} - ${Cache.get(role.cacheKey) ? "otomatis" : "manual"}`,
        `${callbackPrefix}_${role.action}`,
      ),
    ]);
  }

  public message() {
    const chat = this.ctx.chat;
    Database.orm.public.Administrators.where({ UserId: String(chat?.id) })
      .first()
      .then((admin) => {
        if (!admin)
          return this.ctx.reply(
            `⚠️ <b>Access Denied!</b>\nYou're not authorized to use this bot.`,
            { parse_mode: "HTML" },
          );

        var pola = /^\/start$/i;
        if (pola.exec(this.ctx.message?.text!)) {
          var pesan = `👋 Halo ${Utils.getName(this.ctx)}, selamat datang di controller! Kelola userbot Anda di sini.`;
          pesan += `\n\n🕹 <b>Perintah:</b>`;
          pesan += `\n• /gc - tambahkan grup atau kelola grup yang sudah ada.`;
          pesan += `\n• /getrole - dapatkan informasi tentang peran userbot.`;
          pesan += `\n• /next - gunakan perintah ini agar userbot masuk dalam permainan.`;
          pesan += `\n• /smode - (suck mode) gunakan perintah ini untuk membuat userbot bertahan hingga hari yang ditentukan, <b>salah satu userbot harus memiliki peran dokter</b>.`;
          pesan += `\n• /ubot - kelola userbot mana yang akan digunakan.`;
          pesan += `\n• /reset - (berbahaya!) gunakan perintah ini untuk menghapus semua cache.`;
          pesan += `\n• /admin - kelola administrator.`;
          pesan += `\n• /login - masukkan akun Anda dalam script.`;
          pesan += `\n• /restart - mulai ulang server untuk menerapkan perubahan/memperbaiki sesuatu.`;
          pesan += `\n• /log - lihat log.`;

          this.ctx.reply(pesan, { parse_mode: "HTML" });
          Utils.writeLog(
            `[${new Date()}] ${Utils.getNames(this.ctx)} - melakukan start bot.\n`,
          );
          return;
        }

        var pola = /^\/restart$/i;
        if (pola.exec(this.ctx.message?.text!)) {
          if (!admin.CanManageServer)
            return this.ctx.reply(
              `⚠️ <b>Akses Ditolak!</b>\nAnda tidak diizinkan untuk mengoperasikan ini.`,
              { parse_mode: "HTML" },
            );

          var pesan = `⏺️ <b>Restart Server</b>`;
          pesan += `\nMulai ulang untuk menerapkan perubahan atau memperbaiki sesuatu.`;
          let keyb = [];
          keyb[0] = [btn.text(`Restart`, `server_restart`)];

          this.ctx.reply(pesan, {
            parse_mode: "HTML",
            reply_markup: markup.inlineKeyboard(keyb),
          });
          return;
        }

        var pola = /^\/login$/i;
        if (pola.exec(this.ctx.message?.text!)) {
          if (!admin.CanLogin)
            return this.ctx.reply(
              `⚠️ <b>Akses Ditolak!</b>\nAnda tidak diizinkan untuk mengoperasikan ini.`,
              { parse_mode: "HTML" },
            );

          var pesan = `📱 <b>Nomor Telepon</b>`;
          pesan += `\nMasukkan nomor telepon akun Telegram Anda, diawali dengan +`;
          pesan += `\nMisal: +62........`;
          let keyb = [];
          keyb[0] = [btn.text(`❌ Batal`, `login_cancel`)];

          Cache.set(`sessionLogin_${chat?.id}`, true);
          this.ctx.reply(pesan, {
            parse_mode: "HTML",
            reply_markup: markup.inlineKeyboard(keyb),
          });
          return;
        }

        var pola = /^\/admin$/i;
        if (pola.exec(this.ctx.message?.text!)) {
          Utils.writeLog(
            `[${new Date()}] ${Utils.getNames(this.ctx)} - mengakses pusat administrator.\n`,
          );
          this.ctx.reply(`⏳ Memproses...`).then((message_result) => {
            var pesan = `👮‍♂️ <b>Pusat Administrator</b>`;
            pesan += `\nDi sini, Anda dapat menambahkan admin dan mengelola administrator yang sudah ada.`;

            const rows: ReturnType<typeof btn.text>[][] = [];
            const addNext = (
              list: { UserId: string | number | bigint }[],
              i: number,
            ): Promise<void> | undefined => {
              const item = list[i];
              if (!item) return;

              return this.bot.api.getChat(Number(item.UserId)).then((r) => {
                rows.push([
                  btn.text(
                    r.last_name
                      ? `${r.first_name} ${r.last_name}`
                      : String(r.first_name),
                    `admin_manage_${item.UserId}`,
                  ),
                  btn.text(`❌`, `admin_demote_${item.UserId}`),
                ]);

                return addNext(list, i + 1);
              });
            };

            Database.orm.public.Administrators.all()
              .then((adminList) => addNext(adminList, 0))
              .then(() => {
                rows.push([btn.text(`➕ Tambah Admin`, `admin_add_none`)]);
                this.bot.api.editMessageText(
                  message_result.chat.id,
                  message_result.message_id,
                  pesan,
                  {
                    reply_markup: markup.inlineKeyboard(rows),
                    parse_mode: "HTML",
                  },
                );
              });
          });
          return;
        }

        var pola = /^\/log$/i;
        if (pola.exec(this.ctx.message?.text!)) {
          if (!admin.CanViewLog)
            return this.ctx.reply(
              `⚠️ <b>Akses Ditolak!</b>\nAnda tidak diizinkan untuk mengoperasikan ini.`,
              { parse_mode: "HTML" },
            );
          const getLog = Cache.get(`log`);
          let keyb = [];
          keyb[0] = [btn.text(`🗑 Purge`, `log_purge`)];
          if (String(getLog).length > 4000) {
            fs.writeFile("log.txt", String(getLog), "utf-8");
            this.bot.api.sendDocument(chat?.id!, new InputFile("log.txt"), {
              reply_markup: markup.inlineKeyboard(keyb),
            });
            return;
          }
          var pesan = `📝 <b>Log</b>`;
          pesan += `\n${getLog ? `<code>${getLog}</code>` : "Belum ada apapun."}`;

          this.ctx.reply(pesan, {
            parse_mode: "HTML",
            reply_markup: markup.inlineKeyboard(keyb),
          });
          return;
        }

        var pola = /^\/gc$/i;
        if (pola.exec(this.ctx.message?.text!)) {
          Utils.writeLog(
            `[${new Date()}] ${Utils.getNames(this.ctx)} - mengakses perintah /gc.\n`,
          );
          var pesan = `👥 <b>Kelola Grup</b>`;
          pesan += `\nTambahkan grup atau kelola grup yang sudah ada.`;
          let keyb = [];
          keyb[0] = [btn.text(`✏️ Kelola Grup`, `group_manage_none`)];
          keyb[1] = [btn.text(`➕ Tambah Grup`, `group_add_none`)];

          this.ctx.reply(pesan, {
            parse_mode: "HTML",
            reply_markup: markup.inlineKeyboard(keyb),
          });
          return;
        }

        var pola = /^\/getrole$/i;
        if (pola.exec(this.ctx.message?.text!)) {
          if (!admin.CanGetRole)
            return this.ctx.reply(
              `⚠️ <b>Akses Ditolak!</b>\nAnda tidak diizinkan untuk mengoperasikan ini.`,
              { parse_mode: "HTML" },
            );
          Utils.writeLog(
            `[${new Date()}] ${Utils.getNames(this.ctx)} - mengakses perintah /getrole.\n`,
          );
          if (!Cache.get(`groupName`))
            return this.ctx.reply(
              `⚠️ <b>Perhatian!</b>\nBelum ada grup yang ditentukan.`,
              { parse_mode: "HTML" },
            );
          if (!Cache.get(`begins`))
            return this.ctx.reply(
              `⚠️ <b>Perhatian!</b>\nPermainan belum dimulai.`,
              { parse_mode: "HTML" },
            );
          const getRole = Cache.get(`role`);
          if (!getRole)
            return this.ctx.reply(
              `⚠️ <b>Perhatian!</b>\nUserbot belum mendapatkan peran.`,
              { parse_mode: "HTML" },
            );
          if (!Cache.get(`night`))
            return this.ctx.reply(
              `⚠️ <b>Perhatian!</b>\nPeran terdaftar belum lengkap.`,
              { parse_mode: "HTML" },
            );

          this.ctx.reply(`⏳ Memproses...`).then((message_result) => {
            const parsedRoles = Object.fromEntries(
              String(getRole)
                .split(",")
                .map((pair: string) => {
                  const [id, role] = pair.split(":");
                  return [id.trim(), role.trim()];
                }),
            );
            const parsedNames = Object.fromEntries(
              String(Cache.get(`roleNames`))
                .split(",")
                .map((pair: string) => {
                  const [id, name] = pair.split(":");
                  return [id?.trim(), name?.trim()];
                }),
            );

            const result = Object.entries(parsedRoles)
              .map(([id, role]) => {
                const name = parsedNames[id] ?? id;
                return `• ${name} - ${Cache.get(`roleEmot${role}`)}`;
              })
              .join("\n");

            var pesan = `🎎 <b>Peran</b>`;
            pesan += `\nBerikut adalah daftar peran semua userbot yang berada dalam permainan:`;
            pesan += `\n${result}`;

            this.bot.api.editMessageText(
              message_result.chat.id,
              message_result.message_id,
              pesan,
              { parse_mode: "HTML" },
            );
          });
          return;
        }

        var pola = /^\/ubot$/i;
        if (pola.exec(this.ctx.message?.text!)) {
          if (!admin.CanManageUbot)
            return this.ctx.reply(
              `⚠️ <b>Akses Ditolak!</b>\nAnda tidak diizinkan untuk mengoperasikan ini.`,
              { parse_mode: "HTML" },
            );
          Utils.writeLog(
            `[${new Date()}] ${Utils.getNames(this.ctx)} - mengakses perintah /ubot.\n`,
          );
          this.ctx.reply(`⏳ Memproses...`).then((result) => {
            Database.orm.public.DisabledUserBot.select("UserId")
              .all()
              .then((db_result) => {
                const disabledSet = new Set(
                  db_result.map((row) => row.UserId.toString()),
                );
                var pesan = `🤖 <b>Daftar Bot</b>`;
                pesan += `\nKelola userbot mana yang ingin Anda gunakan atau matikan.`;

                const keyb = this.manager
                  .getUsers()
                  .map((u) => [
                    btn.text(
                      `${u.fullName} ${disabledSet.has(u.id) ? "❌" : "✅"}`,
                      `userbot_${u.id}`,
                    ),
                  ]);

                this.ctx.api.editMessageText(
                  result.chat.id,
                  result.message_id,
                  `${pesan}\nTotal: ${keyb.length}`,
                  {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: keyb },
                  },
                );
              });
          });
          return;
        }

        var pola = /^\/next$/i;
        if (pola.exec(this.ctx.message?.text!)) {
          if (!admin.CanUseNext)
            return this.ctx.reply(
              `⚠️ <b>Akses Ditolak!</b>\nAnda tidak diizinkan untuk mengoperasikan ini.`,
              { parse_mode: "HTML" },
            );
          Utils.writeLog(
            `[${new Date()}] ${Utils.getNames(this.ctx)} - meangakses perintah /next.\n`,
          );
          if (Cache.get(`mode`))
            return this.ctx.reply(
              `⚠️ <b>Perhatian!</b>\nSuck mode harus dihentikan terlebih dahulu.`,
              { parse_mode: "HTML" },
            );
          if (Cache.get(`join`))
            return this.ctx.reply(
              `⚠️ <b>Perhatian!</b>\nHanya 1 grup setiap saat - ${Cache.get(`groupName`)}.\n${Cache.get(`continu`) ? "🔁 Continuous sedang aktif." : ""}`,
              { parse_mode: "HTML" },
            );
          this.ctx.reply(`⏳ Memproses...`).then((result) => {
            var pesan = `👥 <b>Pilih Grup</b>`;
            pesan += `\nPilih grup di mana Anda ingin mengirim perintah /next`;
            pesan += `\nNama grup tidak terbaru? Tekan tombol refresh.`;
            Database.orm.public.Group.all().then((db_result) => {
              let keyb = [];

              for (var i = 0; i < db_result.length; i++) {
                keyb.push([
                  btn.text(
                    db_result[i].GroupName,
                    `next_${db_result[i].GroupId}_method`,
                  ),
                ]);
              }
              keyb.push([btn.text(`🔄 Refresh`, `next_refresh_none`)]);

              this.bot.api.editMessageText(
                chat?.id!,
                result.message_id,
                pesan,
                {
                  parse_mode: "HTML",
                  reply_markup: markup.inlineKeyboard(keyb),
                },
              );
            });
          });
          return;
        }

        var pola = /^\/smode$/i;
        if (pola.exec(this.ctx.message?.text!)) {
          if (!admin.CanManageSmode)
            return this.ctx.reply(
              `⚠️ <b>Akses Ditolak!</b>\nAnda tidak diizinkan untuk mengoperasikan ini.`,
              { parse_mode: "HTML" },
            );
          Utils.writeLog(
            `[${new Date()}] ${Utils.getNames(this.ctx)} - mengakses perintah /smode.\n`,
          );
          if (!Cache.get(`groupName`))
            return this.ctx.reply(
              `⚠️ <b>Perhatian!</b>\nBelum ada grup yang ditentukan.`,
              { parse_mode: "HTML" },
            );
          this.ctx.reply(`⏳ Memproses...`).then((result) => {
            if (Cache.get("mode") === "afkmode") {
              var pesan = `🧨 <b>Suck Mode</b>`;
              pesan += `\nSuck mode sedang aktif di ${Cache.get(`groupName`)}, apakah Anda ingin menonaktifkannya?\n\nTekan tombol berisikan peran jika Anda ingin peran tersebut otomatis berjalan.\nHari diatur: ${Cache.get(`afkmodeDur`)}`;
              pesan += `\n\n• 🎎 Afk Semua - membuat semua userbot afk hingga permainan berakhir.`;
              pesan += `\n• 🔁 Continuous - aktifkan fitur ini untuk membuat smode berjalan selama mungkin tanpa bergantung pada jumlah hari yang ditentukan.`;

              let keyb: any[] = [];
              keyb.push([
                btn.text(`🗳 Mode Pemilihan`, `afkmode_election_none`),
                btn.text(`🏙 Ganti Hari`, `afkmode_day_none`),
              ]);
              keyb.push(...this.buildRoleButtons("afkmode_role"));
              keyb.push([
                btn.text(
                  `🎎 Afk Semua ${Cache.get(`allroleAfk`) ? "✅" : "❌"}`,
                  `afkmode_afkrl_none`,
                ),
                btn.text(
                  `🔁 Continuous ${Cache.get(`continu`) ? "✅" : "❌"}`,
                  `afkmode_conti_none`,
                ),
              ]);
              keyb.push([btn.text(`⛔️ Hentikan`, `afkmode_disable_none`)]);

              this.bot.api.editMessageText(
                chat?.id!,
                result.message_id,
                pesan,
                {
                  parse_mode: "HTML",
                  reply_markup: markup.inlineKeyboard(keyb),
                },
              );
              return;
            }

            if (!admin.CanStartSmode)
              return this.ctx.reply(
                `⚠️ <b>Akses Ditolak!</b>\nAnda tidak diizinkan untuk mengoperasikan ini.`,
                { parse_mode: "HTML" },
              );

            Cache.set(`afkmodeHook`, true);
            Cache.set(`afkmodeDet`, true);
            Cache.set(`afkmodeMani`, true);
            Cache.set(`afkmodeSanta`, true);
            Cache.set(`afkmodeDonCh`, true);
            var pesan = `❇️ <b>Masukkan Angka</b>`;
            pesan += `\nBerapa lama Anda ingin ngehama?`;
            let keyb = [];
            keyb[0] = [btn.text(`❌ Batal`, `cancel_`)];

            Cache.set(`smode_session_${chat?.id}`, true);
            this.bot.api.editMessageText(chat?.id!, result.message_id, pesan, {
              parse_mode: "HTML",
              reply_markup: markup.inlineKeyboard(keyb),
            });
          });
          return;
        }

        var pola = /^\/reset$/i;
        if (pola.exec(this.ctx.message?.text!)) {
          if (!admin.CanUseReset)
            return this.ctx.reply(
              `⚠️ <b>Akses Ditolak!</b>\nAnda tidak diizinkan untuk mengoperasikan ini.`,
              { parse_mode: "HTML" },
            );
          Utils.writeLog(
            `[${new Date()}] ${Utils.getNames(this.ctx)} - mengakses perintah /reset.\n`,
          );
          var pesan = `⚠️ <b>Perhatian!</b>`;
          pesan += `\nApakah Anda ingin menghapus semua cache? suck mode yang aktif, next yang sudah dikirim akan terdampak.`;
          let keyb = [];
          keyb[0] = [
            btn.text(`❌ Batal`, `close_`),
            btn.text(`✅ Ya`, `reset_`),
          ];
          this.ctx.reply(pesan, {
            parse_mode: "HTML",
            reply_markup: markup.inlineKeyboard(keyb),
          });
          return;
        }

        // SESSION
        const getSmodeSession = Cache.get(`smode_session_${chat?.id}`);
        const getAddgcSession = Cache.get(`session_addgc_${chat?.id}`);
        const getAddAdmSession = Cache.get(`sessionAddAdm_${chat?.id}`);
        const getLoginSession = Cache.get(`sessionLogin_${chat?.id}`);
        const getLoginCodeSession = Cache.get(`sessionVerifyCode_${chat?.id}`);
        const getLoginPassSession = Cache.get(`sessionVerifyPass_${chat?.id}`);
        if (getSmodeSession) {
          if (!admin.CanStartSmode || !admin.CanManageSmode) {
            Cache.del(`smode_session_${chat?.id}`);
            return this.ctx.reply(
              `⚠️ <b>Akses Ditolak!</b>\nAnda tidak diizinkan untuk mengoperasikan ini.`,
              { parse_mode: "HTML" },
            );
          }
          if (!this.ctx.message?.text) {
            return this.ctx.reply(`⚠️ Hanya teks.`, { parse_mode: "HTML" });
          }
          if (/\D+/i.exec(this.ctx.message?.text!))
            return this.ctx.reply(
              `⚠️ <b>Perhatian!</b>\nMasukkan angka yang valid untuk durasi ngehama.`,
              { parse_mode: "HTML" },
            );
          if (Number(this.ctx.message?.text) <= 0)
            return this.ctx.reply(
              `⚠️ <b>Perhatian!</b>\nHari harus lebih besari dari 0.`,
              { parse_mode: "HTML" },
            );
          let pesan = "";
          let keyb = [];
          if (!Cache.get(`mode`)) {
            pesan = `🗳 <b>Mode Pemilihan</b>`;
            pesan += `\nApakah Anda ingin melewati pemilihan? jika ya, maka semua userbot akan memilih target acak dari daftar userbot (target ditentukan apabila dia tidak memiliki peran aktif).`;

            keyb[0] = [
              btn.text(`Gunakan ✅`, `afkmode_vote_yes`),
              btn.text(`Lewati`, `afkmode_vote_no`),
            ];
            keyb[1] = [
              btn.text(`❌ Batal`, `cancel_`),
              btn.text(`Lanjut ➡️`, `afkmode_rlset_none`),
            ];
            Cache.set(`useVote`, "yes");
          } else {
            if (
              Number(this.ctx.message?.text) < Number(Cache.get(`dayNow`) ?? 0)
            )
              return this.ctx.reply(
                `⚠️ <b>Perhatian!</b>\nSaat ini hari dalam permainan telah berjalan selama ${Cache.get(`dayNow`)} hari, Anda harus meningkatkan durasi ngehama.`,
                { parse_mode: "HTML" },
              );

            pesan = "✅ <b>Hari Diubah!</b>";
            pesan += `\nDurasi ngehama ditingkatkan hingga hari ke-${this.ctx.message?.text}.`;
          }

          Cache.set(`afkmodeDur`, Number(this.ctx.message?.text!));
          Cache.del(`smode_session_${chat?.id}`);
          if (!Cache.get(`mode`)) {
            this.ctx.reply(pesan, {
              parse_mode: "HTML",
              reply_markup: markup.inlineKeyboard(keyb),
            });
          } else {
            Utils.sendMessageToAdmin(this.bot, pesan);
          }

          return;
        }

        if (getAddgcSession) {
          if (!admin.CanAddGroup) {
            Cache.del(`session_addgc_${chat?.id}`);
            return this.ctx.reply(
              `⚠️ <b>Akses Ditolak!</b>\nAnda tidak diizinkan untuk mengoperasikan ini.`,
              { parse_mode: "HTML" },
            );
          }
          if (!this.ctx.message?.text) {
            return this.ctx.reply(`⚠️ Hanya teks.`, { parse_mode: "HTML" });
          }
          this.ctx
            .reply(`⏳ Mencari informasi dari salah satu userbot...`)
            .then((message_result) => {
              const groupText = String(this.ctx.message?.text!);
              this.manager
                .firstSuccess((ref) =>
                  this.manager.getGroupInfo(ref, groupText),
                )
                .then(
                  async (entity) => {
                    Cache.del(`session_addgc_${chat?.id}`);
                    const groupId = `-100${entity.id}`;

                    let pesan = `✅ <b>Ditambahkan</b>`;
                    pesan += `\nGrup telah ditambahkan, berikut informasinya:`;
                    pesan += `\n\nNama: ${entity.title ?? "-"}`;
                    pesan += `\nID: <code>${groupId}</code>`;
                    pesan += `\nUsername: ${entity.username ? `@${entity.username}` : "-"}`;
                    pesan += `\nPeserta: ${entity.total ?? "-"}`;

                    Utils.writeLog(
                      `[${new Date()}] ${Utils.getNames(this.ctx)} - menambahkan grup baru: ${entity.title}.\n`,
                    );
                    await Database.orm.public.Group.create({
                      GroupId: groupId,
                      GroupName: String(entity.title),
                    });
                    this.ctx.api.editMessageText(
                      message_result.chat.id,
                      message_result.message_id,
                      pesan,
                      { parse_mode: "HTML" },
                    );
                  },
                  () => {
                    this.ctx.api.editMessageText(
                      message_result.chat.id,
                      message_result.message_id,
                      `❌ <b>Gagal!</b>\nTidak ada userbot yang bisa mendapatkan info grup tersebut, silahkan periksa:\n• Apakah grup tersebut ada?\n• Jika privat, Anda harus menambahkan salah 1 userbot ke sana.`,
                      { parse_mode: "HTML" },
                    );
                  },
                );
            });
          return;
        }

        if (getAddAdmSession) {
          if (!admin.CanPromoteUser) {
            Cache.del(`sessionAddAdm_${chat?.id}`);
            return this.ctx.reply(
              `⚠️ <b>Akses Ditolak!</b>\nAnda tidak diizinkan untuk mengoperasikan ini.`,
              { parse_mode: "HTML" },
            );
          }
          if (!this.ctx.message?.text) {
            return this.ctx.reply(`⚠️ Hanya teks.`, { parse_mode: "HTML" });
          }
          if (/\D+/i.exec(this.ctx.message?.text!))
            return this.ctx.reply(`⚠️ <b>Perhatian!</b>\nHanya angka.`, {
              parse_mode: "HTML",
            });
          if (Number(this.ctx.message?.text) <= 0)
            return this.ctx.reply(
              `⚠️ <b>Perhatian!</b>\nHarus lebih besari dari 0.`,
              { parse_mode: "HTML" },
            );

          this.ctx.reply(`⏳ Memproses...`).then((message_result) => {
            const target = String(this.ctx.message?.text);

            Database.orm.public.Administrators.where({ UserId: target })
              .first()
              .then((result) => {
                if (result)
                  return this.bot.api.editMessageText(
                    message_result.chat.id,
                    message_result.message_id,
                    `⚠️ <b>Ada!</b>\nPengguna sudah berada dalam admin list.`,
                    { parse_mode: "HTML" },
                  );

                return this.bot.api.getChat(target).then((r) => {
                  const nama = r.last_name
                    ? `${r.first_name} ${r.last_name}`
                    : r.first_name;
                  Cache.del(`sessionAddAdm_${chat?.id}`);
                  Cache.set(`promoteDraft_${chat?.id}`, {
                    target,
                    perms: {},
                  } as PromoteDraft);

                  return this.bot.api.editMessageText(
                    message_result.chat.id,
                    message_result.message_id,
                    `👮‍♂️ <b>Angkat ${nama}</b>\nPilih izin yang akan diberikan. Izin bertanda 🔒 tidak bisa Anda berikan karena Anda sendiri tidak memilikinya.`,
                    {
                      parse_mode: "HTML",
                      reply_markup: markup.inlineKeyboard(
                        this.buildPromoteKeyboard(admin, target, {}),
                      ),
                    },
                  );
                });
              })
              .catch(() =>
                this.bot.api.editMessageText(
                  message_result.chat.id,
                  message_result.message_id,
                  `⚠️ <b>Gagal!</b>\nPengguna tidak ditemukan, pastikan dia sudah start bot.`,
                  { parse_mode: "HTML" },
                ),
              );
          });
          return;
        }

        if (getLoginSession) {
          if (!admin.CanLogin) {
            Cache.del(`sessionLogin_${chat?.id}`);
            return this.ctx.reply(
              `⚠️ <b>Akses Ditolak!</b>\nAnda tidak diizinkan untuk mengoperasikan ini.`,
              { parse_mode: "HTML" },
            );
          }
          if (!this.ctx.message?.text)
            return this.ctx.reply(`⚠️ Hanya teks.`, { parse_mode: "HTML" });

          const phone = this.ctx.message.text.replace(/[\s-]/g, "");
          if (!phone.startsWith("+"))
            return this.ctx.reply(`⚠️ Nomor harus diawali +`, {
              parse_mode: "HTML",
            });
          if (!/^\+\d{8,15}$/.test(phone))
            return this.ctx.reply(
              `⚠️ Nomor tidak valid (8-15 angka setelah +).`,
              {
                parse_mode: "HTML",
              },
            );

          const digits = phone.slice(1);
          const chatId = String(chat?.id);
          const apiId = Number(process.env["API_ID"]);
          const apiHash = String(process.env["API_HASH"]);

          Database.orm.public.Userbots.where({ Phone: digits })
            .first()
            .then((row): Promise<unknown> => {
              if (row) {
                return this.ctx.reply(
                  `⚠️ <b>Sudah Terhubung!</b>\nNomor ini sudah terdaftar sebagai userbot.`,
                  { parse_mode: "HTML" },
                );
              }

              return this.ctx
                .reply(`⏳ Menghubungkan MTProto...`)
                .then((msg) => {
                  const edit = (text: string, extra: object = {}) =>
                    this.bot.api.editMessageText(
                      msg.chat.id,
                      msg.message_id,
                      text,
                      {
                        parse_mode: "HTML",
                        ...extra,
                      },
                    );

                  const client = new TelegramClient(
                    new StringSession(""),
                    apiId,
                    apiHash,
                    {
                      connectionRetries: 5,
                    },
                  );

                  return this.dropLoginClient(chatId)
                    .then(() => client.connect())
                    .then(() => {
                      loginClients.set(chatId, client);
                      setTimeout(() => {
                        if (loginClients.get(chatId) === client)
                          this.dropLoginClient(chatId);
                      }, 5 * 60_000);
                      return edit(
                        `⏳ Mengirim kode ke <code>+${digits}</code>...`,
                      );
                    })
                    .then(() => client.sendCode({ apiId, apiHash }, digits))
                    .then((r) => {
                      if (r.emailRequired || r.emailCodeSent)
                        edit(`⚠️ Tidak mendukung email login.`);

                      Cache.del(`sessionLogin_${chatId}`);
                      Cache.set(`sessionVerifyCode_${chatId}`, digits);
                      Cache.set(`phoneHash_${chatId}`, r.phoneCodeHash);

                      const keyb = [
                        [btn.text(`🔄 Minta Kode`, `login_code`)],
                        [btn.text(`❌ Batal`, `login_cancel`)],
                      ];
                      return edit(
                        `✅ <b>Kode Terkirim!</b>\nKirimkan kode yang telah masuk ke akun yang Anda daftarkan. Kode tidak masuk? tekan tombol Minta Kode untuk meminta kode lagi.`,
                        { reply_markup: markup.inlineKeyboard(keyb) },
                      );
                    })
                    .catch((err) => {
                      this.dropLoginClient(chatId);
                      return edit(
                        `⚠️ <b>Gagal!</b>\n${err?.errorMessage ?? err?.message ?? err}`,
                      );
                    });
                });
            })
            .catch((err) => {
              console.error("Gagal cek nomor:", err);
              return this.ctx.reply(
                `⚠️ Gagal mengecek nomor: ${err instanceof Error ? err.message : err}`,
              );
            });
          return;
        }

        if (getLoginCodeSession) {
          const chatId = String(chat?.id);
          const digits = String(getLoginCodeSession).trim();

          if (!admin.CanLogin) {
            this.dropLoginClient(chatId);
            return this.ctx.reply(
              `⚠️ <b>Akses Ditolak!</b>\nAnda tidak diizinkan untuk mengoperasikan ini.`,
              { parse_mode: "HTML" },
            );
          }

          const client = loginClients.get(chatId);
          if (!client) {
            this.dropLoginClient(chatId);
            return this.ctx.reply(`⚠️ Sesi login habis, mulai lagi.`);
          }
          if (!this.ctx.message?.text)
            return this.ctx.reply(`⚠️ Hanya teks.`, { parse_mode: "HTML" });

          const code = this.ctx.message.text.replace(/\D/g, "");
          if (code.length !== 5)
            return this.ctx.reply(`⚠️ Kode terdiri dari 5 angka.`, {
              parse_mode: "HTML",
            });

          this.ctx.reply(`⏳ Memverifikasi...`).then((message_result) => {
            const edit = (text: string, extra: object = {}) =>
              this.bot.api.editMessageText(
                message_result.chat.id,
                message_result.message_id,
                text,
                { parse_mode: "HTML", ...extra },
              );

            client
              .invoke(
                new Api.auth.SignIn({
                  phoneNumber: digits,
                  phoneCodeHash: String(Cache.get(`phoneHash_${chatId}`)),
                  phoneCode: code,
                }),
              )
              .then((res) => {
                if (res instanceof Api.auth.AuthorizationSignUpRequired)
                  throw new Error("Nomor ini belum punya akun Telegram.");

                return this.finishLogin(chatId, digits, edit);
              })
              .catch((err) => {
                const em = err?.errorMessage;

                if (em === "SESSION_PASSWORD_NEEDED") {
                  Cache.del(`sessionVerifyCode_${chatId}`);
                  Cache.del(`phoneHash_${chatId}`);
                  Cache.set(`sessionVerifyPass_${chatId}`, digits);
                  return edit(
                    `🔐 <b>Kata Sandi</b>\nMasukkan kata sandi untuk <code>+${digits}</code>`,
                    {
                      reply_markup: markup.inlineKeyboard([
                        [btn.text(`❌ Batal`, `login_cancel`)],
                      ]),
                    },
                  );
                }

                if (em === "PHONE_CODE_INVALID")
                  return edit(`⚠️ <b>Kode Salah</b>\nKirim kode yang benar.`, {
                    reply_markup: markup.inlineKeyboard([
                      [btn.text(`🔄 Minta Kode`, `login_code`)],
                      [btn.text(`❌ Batal`, `login_cancel`)],
                    ]),
                  });

                if (em === "PHONE_CODE_EXPIRED") {
                  return edit(
                    `⚠️ <b>Kode Kedaluwarsa</b>\nKode untuk <code>+${digits}</code> sudah kedaluwarsa.`,
                    {
                      reply_markup: markup.inlineKeyboard([
                        [btn.text(`🔄 Minta Kode`, `login_code`)],
                        [btn.text(`❌ Batal`, `login_cancel`)],
                      ]),
                    },
                  );
                }

                this.dropLoginClient(chatId);
                return edit(
                  `⚠️ Gagal memverifikasi: ${em ?? err?.message ?? err}`,
                );
              });
          });
          return;
        }

        if (getLoginPassSession) {
          if (!admin.CanLogin) {
            Cache.del(`sessionVerifyCode_${chat?.id}`);
            return this.ctx.reply(
              `⚠️ <b>Akses Ditolak!</b>\nAnda tidak diizinkan untuk mengoperasikan ini.`,
              { parse_mode: "HTML" },
            );
          }
          const chatId = String(chat?.id);
          const apiId = Number(process.env["API_ID"]);
          const apiHash = String(process.env["API_HASH"]);
          const client = loginClients.get(chatId);
          if (!client) {
            this.dropLoginClient(chatId);
            return this.ctx.reply(`⚠️ Sesi login habis, mulai lagi.`);
          }
          if (!this.ctx.message?.text)
            return this.ctx.reply(`⚠️ Hanya teks.`, { parse_mode: "HTML" });

          this.ctx.reply(`⏳ Memverifikasi...`).then((message_result) => {
            const edit = (text: string, extra: object = {}) =>
              this.bot.api.editMessageText(
                message_result.chat.id,
                message_result.message_id,
                text,
                { parse_mode: "HTML", ...extra },
              );
            client
              .signInWithPassword(
                { apiId, apiHash },
                {
                  password: () =>
                    Promise.resolve(String(this.ctx.message?.text)),
                  onError: (e) => {
                    throw e;
                  },
                },
              )
              .then(() =>
                this.finishLogin(chatId, String(getLoginPassSession), edit),
              )
              .catch((err) => {
                if (String(err?.errorMessage).includes("PASSWORD_HASH_INVALID"))
                  return edit(
                    `⚠️ <b>Password salah.</b>\nKirim password yang benar.`,
                    {
                      reply_markup: markup.inlineKeyboard([
                        [btn.text(`❌ Batal`, `login_cancel`)],
                      ]),
                    },
                  );

                this.dropLoginClient(chatId);
                return edit(
                  `⚠️ Gagal memverifikasi: ${err?.errorMessage ?? err?.message ?? err}`,
                );
              });
          });
        }
      });
  }

  public callback() {
    const chat = this.ctx.chat;
    Database.orm.public.Administrators.where({ UserId: String(chat?.id) })
      .first()
      .then((admin) => {
        if (!admin)
          return this.ctx.answerCallbackQuery({
            text: "⚠️ Access Denied!\nYou're not authorized to use this bot.",
            show_alert: true,
          });

        const callback = this.ctx.callbackQuery;
        const cbData = String(callback?.data);
        let mc;

        var pola = /^log_(.*)$/i;
        if ((mc = pola.exec(cbData))) {
          if (!admin.CanManageGroup && !admin.CanViewLog)
            return this.ctx.answerCallbackQuery({
              text: "⚠️ Akses Ditolak\nAnda tidak diizinkan untuk mengoperasikan ini.",
              show_alert: true,
            });
          const type = mc[1];

          if (type === "purge") {
            Cache.del(`log`);
            var pesan = `📝 <b>Log</b>`;
            pesan += `\nBelum ada apapun.`;
            let keyb = [];
            keyb[0] = [btn.text(`🗑 Purge`, `log_purge`)];

            if (String(Cache.get(`log`)).length > 4000) {
              this.ctx.deleteMessage().catch(() => {});
              this.ctx
                .reply(pesan, {
                  parse_mode: "HTML",
                  reply_markup: markup.inlineKeyboard(keyb),
                })
                .catch(() => {});
            } else {
              this.ctx
                .editMessageText(pesan, {
                  parse_mode: "HTML",
                  reply_markup: markup.inlineKeyboard(keyb),
                })
                .catch(() => {});
            }
            this.ctx.answerCallbackQuery();
            return;
          }
        }

        var pola = /^cancel_$/i;
        if (pola.exec(cbData)) {
          Cache.del(`useVote`);
          Cache.del(`mode`);
          Cache.del(`smode_session_${this.ctx.chat?.id}`);
          Cache.del(`afkmodeDet`);
          Cache.del(`afkmodeHook`);
          Cache.del(`afkmodeMani`);
          Cache.del(`afkmodeSanta`);
          this.ctx.editMessageText(`❌ <b>Dibatalkan!</b>`, {
            parse_mode: "HTML",
          });
          return;
        }

        var pola = /^nothing$/i;
        if (pola.exec(cbData)) {
          return this.ctx.answerCallbackQuery();
        }

        var pola = /^close_$/i;
        if (pola.exec(cbData)) {
          this.ctx.deleteMessage().catch(() => {});
          return;
        }

        var pola = /^reset_$/i;
        if (pola.exec(cbData)) {
          if (!admin.CanUseReset)
            return this.ctx.answerCallbackQuery({
              text: "⚠️ Akses Ditolak\nAnda tidak diizinkan untuk mengoperasikan ini.",
              show_alert: true,
            });
          Cache.flushAll();
          this.ctx.editMessageText(
            `✅ <b>Berhasil!</b>\nSemua cache telah dihapus.`,
            { parse_mode: "HTML" },
          );
          return;
        }

        var pola = /^server_(.*)$/i;
        if ((mc = pola.exec(cbData))) {
          if (!admin.CanManageServer)
            return this.ctx.answerCallbackQuery({
              text: "⚠️ Akses Ditolak\nAnda tidak diizinkan untuk mengoperasikan ini.",
              show_alert: true,
            });

          const act = mc[1];
          if (act === "restart") {
            Utils.writeLog(
              `[${new Date()}] ${Utils.getNames(this.ctx)} - melakukan restart server.\n`,
            );
            return this.ctx
              .editMessageText(
                `🔄 <b>Memulai Ulang...</b>\nBot akan aktif kembali dalam beberapa detik.`,
                { parse_mode: "HTML" },
              )
              .catch(() => {})
              .then(() => this.ctx.answerCallbackQuery().catch(() => {}))
              .then(() => Lifecycle.restart());
          }
        }

        var pola = /^login_(.*)$/i;
        if ((mc = pola.exec(cbData))) {
          if (!admin.CanLogin)
            return this.ctx.answerCallbackQuery({
              text: "⚠️ Akses Ditolak\nAnda tidak diizinkan untuk mengoperasikan ini.",
              show_alert: true,
            });
          const act = mc[1];

          if (act === "cancel") {
            this.dropLoginClient(String(chat?.id));
            this.ctx.editMessageText(`❌ <b>Dibatalkan!</b>`, {
              parse_mode: "HTML",
            });
            return;
          }

          if (act === "code") {
            Utils.writeLog(
              `[${new Date()}] ${Utils.getNames(this.ctx)} - meminta ulang kode masuk.\n`,
            );
            this.ctx.editMessageText(`⏳ Mengirim ulang kode`).then(() => {
              const client = loginClients.get(String(chat?.id));
              const phone = Cache.get(`sessionVerifyCode_${chat?.id}`);
              const apiId = Number(process.env["API_ID"]);
              const apiHash = String(process.env["API_HASH"]);
              const keyb = [
                [btn.text(`🔄 Minta Kode`, `login_code`)],
                [btn.text(`❌ Batal`, `login_cancel`)],
              ];
              const pesan = `✅ <b>Kode Terkirim!</b>\nKirimkan kode yang telah masuk ke akun yang Anda daftarkan. Kode tidak masuk? tekan tombol Minta Kode untuk meminta kode lagi.`;

              client
                ?.sendCode({ apiId, apiHash }, String(phone).trim())
                .then(() => {
                  this.ctx.answerCallbackQuery({
                    text: `✅ Berhasil!\nKode berhasil dikirim ulang.`,
                    show_alert: true,
                  });
                  this.ctx.editMessageText(pesan, {
                    reply_markup: markup.inlineKeyboard(keyb),
                    parse_mode: "HTML",
                  });
                })
                .catch(() => {
                  this.ctx.answerCallbackQuery({
                    text: `⚠️ Gagal!\nGagal mengirim kode, Anda mungkin terlalu banyak mencoba.`,
                    show_alert: true,
                  });
                  this.ctx.editMessageText(pesan, {
                    reply_markup: markup.inlineKeyboard(keyb),
                    parse_mode: "HTML",
                  });
                });
            });
            return;
          }
        }

        var pola = /^admin_(.*)_(.*)$/i;
        if ((mc = pola.exec(cbData))) {
          const act = mc[1];
          const userId = mc[2];

          if (act === "add") {
            if (!admin.CanPromoteUser)
              return this.ctx.answerCallbackQuery({
                text: "⚠️ Akses Ditolak\nAnda tidak diizinkan untuk mengoperasikan ini.",
                show_alert: true,
              });
            Utils.writeLog(
              `[${new Date()}] ${Utils.getNames(this.ctx)} - ingin menambahkan administrator.\n`,
            );
            var pesan = `❇️ <b>Add Admin</b>`;
            pesan += `\nSend me the user id here, the user must start the bot first.`;
            let keyb = [];
            keyb[0] = [btn.text(`❌ Batal`, `admin_return_none`)];

            Cache.set(`sessionAddAdm_${chat?.id}`, true);
            this.ctx.editMessageText(pesan, {
              parse_mode: "HTML",
              reply_markup: markup.inlineKeyboard(keyb),
            });
            this.ctx.answerCallbackQuery();
            return;
          }

          if (act === "return") {
            Cache.del(`sessionAddAdm_${chat?.id}`);
            this.ctx.editMessageText(`⏳ Memproses...`).then(() => {
              var pesan = `👮‍♂️ <b>Pusat Administrator</b>`;
              pesan += `\nDi sini, Anda dapat menambahkan admin dan mengelola administrator yang sudah ada.`;

              const rows: ReturnType<typeof btn.text>[][] = [];
              const addNext = (
                list: { UserId: string | number | bigint }[],
                i: number,
              ): Promise<void> | undefined => {
                const item = list[i];
                if (!item) return;

                return this.bot.api.getChat(Number(item.UserId)).then((r) => {
                  rows.push([
                    btn.text(
                      r.last_name
                        ? `${r.first_name} ${r.last_name}`
                        : String(r.first_name),
                      `admin_manage_${item.UserId}`,
                    ),
                    btn.text(`❌`, `admin_demote_${item.UserId}`),
                  ]);

                  return addNext(list, i + 1);
                });
              };

              Database.orm.public.Administrators.all()
                .then((adminList) => addNext(adminList, 0))
                .then(() => {
                  rows.push([btn.text(`➕ Tambah Admin`, `admin_add_none`)]);
                  this.ctx.editMessageText(pesan, {
                    reply_markup: markup.inlineKeyboard(rows),
                    parse_mode: "HTML",
                  });
                });
            });
            return;
          }

          if (act.startsWith("tgl:")) {
            if (!admin.CanPromoteUser)
              return this.ctx.answerCallbackQuery({
                text: "⚠️ Akses Ditolak\nAnda tidak diizinkan untuk mengoperasikan ini.",
                show_alert: true,
              });

            const perm = act.slice(4) as PermKey;
            if (!PERMS.some(([key]) => key === perm))
              return this.ctx.answerCallbackQuery();
            if (!admin[perm])
              return this.ctx.answerCallbackQuery({
                text: "⚠️ Akses Ditolak!\nAnda tidak memiliki izin ini.",
                show_alert: true,
              });

            const key = `promoteDraft_${chat?.id}`;
            const draft = Cache.get(key) as PromoteDraft | undefined;
            if (!draft || draft.target !== userId)
              return this.ctx.answerCallbackQuery({
                text: "⚠️ Sesi habis, mulai lagi dari Tambah Admin.",
                show_alert: true,
              });

            draft.perms[perm] = !draft.perms[perm];
            Cache.set(key, draft);

            return this.ctx
              .editMessageReplyMarkup({
                reply_markup: markup.inlineKeyboard(
                  this.buildPromoteKeyboard(admin, userId, draft.perms),
                ),
              })
              .then(() => this.ctx.answerCallbackQuery())
              .catch(() => {});
          }

          if (act === "promote") {
            if (!admin.CanPromoteUser)
              return this.ctx.answerCallbackQuery({
                text: "⚠️ Akses Ditolak\nAnda tidak diizinkan untuk mengoperasikan ini.",
                show_alert: true,
              });

            const key = `promoteDraft_${chat?.id}`;
            const draft = Cache.get(key) as PromoteDraft | undefined;
            if (!draft || draft.target !== userId)
              return this.ctx.answerCallbackQuery({
                text: "⚠️ Sesi habis, mulai lagi dari Tambah Admin.",
                show_alert: true,
              });

            const granted = Object.fromEntries(
              PERMS.map(([k]) => [k, Boolean(draft.perms[k] && admin[k])]),
            );

            Utils.writeLog(
              `[${new Date()}] ${Utils.getNames(this.ctx)} - mengangkat admin baru: ${userId}.\n`,
            );
            return Database.orm.public.Administrators.where({ UserId: userId })
              .first()
              .then((exists) => {
                if (exists)
                  return this.ctx.answerCallbackQuery({
                    text: "⚠️ Ada!\nPengguna sudah menjadi admin.",
                    show_alert: true,
                  });

                return Database.orm.public.Administrators.create({
                  UserId: userId,
                  Promotor: String(chat?.id),
                  ...granted,
                }).then(() => {
                  Cache.del(key);
                  return this.ctx
                    .editMessageText(
                      `✅ <b>Berhasil!</b>\nPengguna telah diangkat menjadi admin.`,
                      {
                        parse_mode: "HTML",
                      },
                    )
                    .then(() => this.ctx.answerCallbackQuery());
                });
              })
              .catch((err) => {
                console.error("Gagal promote admin:", err);
                return this.ctx.answerCallbackQuery({
                  text: "Gagal mengangkat ❌",
                  show_alert: true,
                });
              });
          }

          Database.orm.public.Administrators.where({ UserId: String(userId) })
            .first()
            .then((adm) => {
              if (!adm)
                return this.ctx.answerCallbackQuery({
                  text: "⚠️ Tidak Ada!\nPengguna mungkin bukan admin.",
                  show_alert: true,
                });

              const renderManage = (userId: string, row: typeof adm) =>
                this.bot.api.getChat(userId).then((r) => {
                  this.bot.api.getChat(adm.Promotor).then((promoter) => {
                    const nama = r.last_name
                      ? `${r.first_name} ${r.last_name}`
                      : r.first_name;
                    Utils.writeLog(
                      `[${new Date()}] ${Utils.getNames(this.ctx)} - mengakses/mengubah izn admin: ${nama}.\n`,
                    );
                    const pesan = `👮‍♂️ <b>${nama}</b>\nIzin mana yang akan Anda ubah untuk pengguna ini?\nPromoter: ${promoter.last_name ? `${promoter.first_name} ${promoter.last_name}` : promoter.first_name}`;

                    const keyb = PERMS.map(([key, label]) => [
                      btn.text(
                        `${admin[key] ? "" : "🔒 "}${label} ${row[key] ? "✅" : "❌"}`,
                        `admin_${key}_${userId}`,
                      ),
                    ]);
                    keyb.push([btn.text(`⬅️ Kembali`, `admin_return_none`)]);

                    return this.ctx.editMessageText(pesan, {
                      parse_mode: "HTML",
                      reply_markup: markup.inlineKeyboard(keyb),
                    });
                  });
                });

              if (act === "manage") {
                this.ctx
                  .editMessageText(`⏳ Memproses...`)
                  .then(() => renderManage(String(userId), adm))
                  .then(() => this.ctx.answerCallbackQuery())
                  .catch((err) => console.error("Gagal manage admin:", err));
                return;
              }

              if (PERMS.some(([key]) => key === act)) {
                if (String(userId) === String(chat?.id))
                  return this.ctx.answerCallbackQuery({
                    text: "⚠️ Akses Ditolak!\nAnda tidak dapat mengubah diri Anda.",
                    show_alert: true,
                  });
                if (adm.Promotor !== String(chat?.id) && !admin.IsHighAdmin)
                  return this.ctx.answerCallbackQuery({
                    text: "⚠️ Akses Ditolak!\nAnda bukan promoter pengguna ini.",
                    show_alert: true,
                  });

                const perm = act as PermKey;
                if (!admin[perm])
                  return this.ctx.answerCallbackQuery({
                    text: "⚠️ Akses Ditolak!\nAnda tidak punya izin ini, jadi tidak bisa mengubahnya.",
                    show_alert: true,
                  });

                const target = String(userId);
                const newValue = !adm[perm];

                return Database.orm.public.Administrators.where({
                  UserId: target,
                })
                  .update({ [perm]: newValue })
                  .then(() =>
                    renderManage(target, { ...adm, [perm]: newValue }),
                  )
                  .then(() =>
                    this.ctx.answerCallbackQuery("Berhasil diubah ✅"),
                  )
                  .catch((err) => {
                    if (
                      String(err?.description).includes(
                        "message is not modified",
                      )
                    )
                      return this.ctx.answerCallbackQuery();
                    console.error("Gagal toggle permission:", err);
                    return this.ctx.answerCallbackQuery({
                      text: "Gagal mengubah ❌",
                      show_alert: true,
                    });
                  });
              }

              if (act === "demote" || act === "demoteC") {
                if (String(userId) === String(chat?.id))
                  return this.ctx.answerCallbackQuery({
                    text: "⚠️ Akses Ditolak!\nAnda tidak dapat mencopot diri Anda sendiri.",
                    show_alert: true,
                  });
                if (adm.Promotor !== String(chat?.id))
                  return this.ctx.answerCallbackQuery({
                    text: "⚠️ Akses Ditolak!\nAnda bukan promoter pengguna ini.",
                    show_alert: true,
                  });

                const target = String(userId);

                const getNama = () =>
                  this.bot.api
                    .getChat(target)
                    .then((r) =>
                      r.last_name
                        ? `${r.first_name} ${r.last_name}`
                        : String(r.first_name),
                    )
                    .catch(() => target);

                if (act === "demote") {
                  return getNama()
                    .then((nama) => {
                      const pesan = `⚠️ <b>Perhatian!</b>\nApakah Anda yakin ingin mencopot <b>${nama}</b> dari admin?`;
                      const keyb = [
                        [
                          btn.text(`✅ Ya`, `admin_demoteC_${target}`),
                          btn.text(`❌ Tidak`, `admin_return_none`),
                        ],
                      ];
                      return this.ctx.editMessageText(pesan, {
                        parse_mode: "HTML",
                        reply_markup: markup.inlineKeyboard(keyb),
                      });
                    })
                    .then(() => this.ctx.answerCallbackQuery())
                    .catch((err) =>
                      console.error("Gagal konfirmasi demote:", err),
                    );
                }

                return getNama()
                  .then((nama) =>
                    Database.orm.public.Administrators.where({ UserId: target })
                      .delete()
                      .then(() => {
                        Cache.del(`sessionAddAdm_${target}`);
                        Cache.del(`promoteDraft_${target}`);

                        Utils.writeLog(
                          `[${new Date()}] ${Utils.getNames(this.ctx)} - mencopot admin: ${nama}.\n`,
                        );
                        return this.ctx.editMessageText(
                          `✅ <b>Berhasil!</b>\n<b>${nama}</b> telah dicopot dari admin.`,
                          {
                            parse_mode: "HTML",
                            reply_markup: markup.inlineKeyboard([
                              [btn.text(`⬅️ Kembali`, `admin_return_none`)],
                            ]),
                          },
                        );
                      }),
                  )
                  .then(() =>
                    this.ctx.answerCallbackQuery("Berhasil dicopot ✅"),
                  )
                  .catch((err) => {
                    console.error("Gagal demote admin:", err);
                    return this.ctx.answerCallbackQuery({
                      text: "Gagal mencopot ❌",
                      show_alert: true,
                    });
                  });
              }
            });
        }

        var pola = /^group_(.*)_(.*)$/i;
        if ((mc = pola.exec(cbData))) {
          const type = mc[1];
          const groupId = mc[2];

          if (type === "return") {
            Cache.del(`session_addgc_${chat?.id}`);
            var pesan = `👥 <b>Kelola Grup</b>`;
            pesan += `\nTambahkan grup atau kelola grup yang sudah ada.`;
            let keyb = [];
            keyb[0] = [btn.text(`✏️ Kelola Grup`, `group_manage_none`)];
            keyb[1] = [btn.text(`➕ Tambah Grup`, `group_add_none`)];
            this.ctx.editMessageText(pesan, {
              parse_mode: "HTML",
              reply_markup: markup.inlineKeyboard(keyb),
            });
            return;
          }

          if (type === "add") {
            if (!admin.CanAddGroup)
              return this.ctx.answerCallbackQuery({
                text: "⚠️ Akses Ditolak\nAnda tidak diizinkan untuk mengoperasikan ini.",
                show_alert: true,
              });
            var pesan = `❇️ <b>Grup Baru</b>`;
            pesan += `\n• Silahkan kirim username grup tersebut.`;
            pesan += `\n• Jika grup tersebut privat, Anda harus menambahkan salah 1 userbot ke sana.`;
            let keyb = [];
            keyb[0] = [btn.text(`⬅️ Return`, `group_return_none`)];

            Cache.set(`session_addgc_${chat?.id}`, true);
            this.ctx.editMessageText(pesan, {
              parse_mode: "HTML",
              reply_markup: markup.inlineKeyboard(keyb),
            });
            return;
          }

          if (type === "manage") {
            if (!admin.CanManageGroup)
              return this.ctx.answerCallbackQuery({
                text: "⚠️ Akses Ditolak\nAnda tidak diizinkan untuk mengoperasikan ini.",
                show_alert: true,
              });
            Utils.writeLog(
              `[${new Date()}] ${Utils.getNames(this.ctx)} - mengakses panel kelola grup.\n`,
            );
            this.ctx.editMessageText(`⏳ Memproses...`).then(() => {
              var pesan = `✏️ <b>Kelola Grup</b>`;
              pesan += `\nPilih grup mana yang ingin Anda hapus.`;
              let keyb = [];

              Database.orm.public.Group.all().then((db_result) => {
                if (db_result.length <= 0)
                  return this.ctx.answerCallbackQuery({
                    text: `⚠️ Tidak ada grup.`,
                    show_alert: true,
                  });
                for (var i = 0; i < db_result.length; i++) {
                  keyb.push([
                    btn.text(db_result[i].GroupName, `nothing`),
                    btn.text(`🗑`, `group_del_${db_result[i].GroupId}`),
                  ]);
                }
                keyb.push([btn.text(`⬅️ Return`, `group_return_none`)]);

                this.ctx.editMessageText(pesan, {
                  parse_mode: "HTML",
                  reply_markup: markup.inlineKeyboard(keyb),
                });
              });
            });
            return;
          }

          if (type === "del") {
            if (!admin.CanManageGroup)
              return this.ctx.answerCallbackQuery({
                text: "⚠️ Akses Ditolak\nAnda tidak diizinkan untuk mengoperasikan ini.",
                show_alert: true,
              });
            Utils.writeLog(
              `[${new Date()}] ${Utils.getNames(this.ctx)} - menghapus grup: ${groupId}.\n`,
            );
            this.ctx.editMessageText(`⏳ Memproses...`).then(() => {
              Database.orm.public.Group.where({ GroupId: groupId })
                .delete()
                .then(() => {
                  Database.orm.public.Group.all().then((db_result) => {
                    if (db_result.length <= 0) {
                      var pesan = `👥 <b>Kelola Grup</b>`;
                      pesan += `\nTambahkan grup atau kelola grup yang sudah ada.`;
                      let keyb = [];
                      keyb[0] = [
                        btn.text(`✏️ Kelola Grup`, `group_manage_none`),
                      ];
                      keyb[1] = [btn.text(`➕ Tambah Grup`, `group_add_none`)];
                      this.ctx.editMessageText(pesan, {
                        parse_mode: "HTML",
                        reply_markup: markup.inlineKeyboard(keyb),
                      });
                      return;
                    }

                    var pesan = `✏️ <b>Kelola Grup</b>`;
                    pesan += `\nPilih grup mana yang ingin Anda hapus.`;
                    let keyb = [];

                    for (var i = 0; i < db_result.length; i++) {
                      keyb.push([
                        btn.text(db_result[i].GroupName, `nothing`),
                        btn.text(`🗑`, `group_del_${db_result[i].GroupId}`),
                      ]);
                    }
                    keyb.push([btn.text(`⬅️ Return`, `group_return_none`)]);

                    this.ctx.editMessageText(pesan, {
                      parse_mode: "HTML",
                      reply_markup: markup.inlineKeyboard(keyb),
                    });
                  });
                });
            });
            return;
          }
        }

        var pola = /^next_(.*)_(.*)$/i;
        if ((mc = pola.exec(cbData))) {
          if (!admin.CanUseNext)
            return this.ctx.answerCallbackQuery({
              text: "⚠️ Akses Ditolak\nAnda tidak diizinkan untuk mengoperasikan ini.",
              show_alert: true,
            });
          const type = mc[1];
          const method = mc[2];

          if (type === "cancel") {
            this.ctx.deleteMessage();
            if (!Cache.get(`join`)) {
              this.ctx.answerCallbackQuery({
                text: `Nothing`,
                show_alert: true,
              });
              return;
            }
            Cache.del(`join`);
            Utils.sendMessageToAdmin(
              this.bot,
              `❌ <b>Pendaftaran Dibatalkan!</b>\nUserbot tidak akan bergabung dalam permainan.`,
            );
            return;
          }

          if (type === "refresh") {
            Utils.writeLog(
              `[${new Date()}] ${Utils.getNames(this.ctx)} - melakukan refresh daftar grup.\n`,
            );
            this.ctx.editMessageText(`⏳ Memproses...`).then(() => {
              const updateAllGroupNames = () => {
                Database.orm.public.Group.select("GroupId")
                  .all()
                  .then((dbResult) => {
                    let successCount = 0;
                    let failCount = 0;

                    const processGroup = (groupIndex: number): void => {
                      if (groupIndex >= dbResult.length) {
                        if (successCount > 0) {
                          let keyb = [];
                          keyb[0] = [
                            btn.text(`⬅️ Kembali`, `next_return_none`),
                          ];
                          this.ctx.editMessageText(
                            `✅ <b>Berhasil!</b>\n${successCount} grup berhasil diperbarui.` +
                              (failCount > 0
                                ? `\n⚠️ ${failCount} grup gagal diperbarui (tidak ada userbot yang bisa mengakses).`
                                : ""),
                            {
                              parse_mode: "HTML",
                              reply_markup: markup.inlineKeyboard(keyb),
                            },
                          );
                          this.ctx.answerCallbackQuery().catch(() => {});
                        } else {
                          this.ctx.editMessageText(
                            `❌ <b>Gagal!</b>\nTidak ada userbot yang bisa mendapatkan info grup tersebut, salah 1 grup tidak tersedia atau userbot tidak berada dalam grup tersebut.`,
                            { parse_mode: "HTML" },
                          );
                        }
                        return;
                      }

                      const groupId = dbResult[groupIndex].GroupId;

                      this.manager
                        .firstSuccess((ref) =>
                          this.manager.getGroupInfo(ref, groupId),
                        )
                        .then((info) =>
                          Database.orm.public.Group.where({
                            GroupId: groupId,
                          }).update({ GroupName: String(info.title) }),
                        )
                        .then(() => {
                          successCount++;
                        })
                        .catch(() => {
                          failCount++;
                        })
                        .finally(() => processGroup(groupIndex + 1));
                    };

                    processGroup(0);
                  });
              };

              updateAllGroupNames();
            });
            return;
          }

          if (type === "return") {
            this.ctx.editMessageText(`⏳ Memproses...`).then(() => {
              var pesan = `👥 <b>Pilih Grup</b>`;
              pesan += `\nPilih grup di mana Anda ingin mengirim perintah /next`;
              pesan += `\nNama grup tidak terbaru? Tekan tombol refresh.`;
              Database.orm.public.Group.all().then((db_result) => {
                let keyb = [];

                for (var i = 0; i < db_result.length; i++) {
                  keyb.push([
                    btn.text(
                      db_result[i].GroupName,
                      `next_${db_result[i].GroupId}_method`,
                    ),
                  ]);
                }
                keyb.push([btn.text(`🔄 Refresh`, `next_refresh_none`)]);

                this.ctx.editMessageText(pesan, {
                  parse_mode: "HTML",
                  reply_markup: markup.inlineKeyboard(keyb),
                });
                this.ctx.answerCallbackQuery().catch(() => {});
              });
            });
            return;
          }

          if (method === "method") {
            var pesan = `⏩ <b>Metode Bergabung</b>`;
            pesan += `\nPilih metode bergabung permainan`;
            pesan += `\n• Next - userbot akan mengirim perintah /next ke grup tujuan.`;
            pesan += `\n• Direct - userbot akan menunggu pendaftaran dibuka dalam grup tujuan.`;
            let keyb = [];
            keyb[0] = [
              btn.text(`Next`, `next_${mc[1]}_send`),
              btn.text(`Direct`, `next_${mc[1]}_direct`),
            ];
            keyb[1] = [btn.text(`⬅️ Kembali`, `next_return_none`)];

            this.ctx.editMessageText(pesan, {
              parse_mode: "HTML",
              reply_markup: markup.inlineKeyboard(keyb),
            });
            this.ctx.answerCallbackQuery().catch(() => {});
            return;
          }

          if (method === "direct") {
            const target = mc[1];
            Utils.writeLog(
              `[${new Date()}] ${Utils.getNames(this.ctx)} - melakukan next dengan metode direct.\n`,
            );
            this.ctx.editMessageText(`⏳ Memproses...`).then(() => {
              Cache.set(`join`, "direct");
              Cache.set(`groupTarget`, target);
              Database.orm.public.DisabledUserBot.select("UserId")
                .all()
                .then((db_result) => {
                  db_result.map((id) => {
                    Cache.set(`userbot_${id}_disabled`, true);
                  });
                  Database.orm.public.Group.where({ GroupId: target })
                    .select("GroupName")
                    .first()
                    .then((db_result) => {
                      Cache.set(`groupName`, db_result?.GroupName);
                      var pesan = `✅ <b>Metode Diatur!</b>`;
                      pesan += `\nUserbot akan bergabung dalam permainan ketika pendaftaran dibuka di ${db_result?.GroupName}`;
                      let keyb: any[] = [];
                      keyb[0] = [btn.text(`❌ Batalkan`, `next_cancel_none`)];

                      this.ctx.deleteMessage();
                      Utils.sendMessageToAdmin(this.bot, pesan, keyb);
                    });
                });
            });
            return;
          }

          if (method === "send") {
            const target = mc[1];
            Utils.writeLog(
              `[${new Date()}] ${Utils.getNames(this.ctx)} - melakukan next dengan metode send.\n`,
            );
            this.ctx.editMessageText(`⏳ Memproses...`).then(() => {
              Cache.set(`groupTarget`, target);
              Cache.set(`join`, "next");

              Database.orm.public.DisabledUserBot.select("UserId")
                .all()
                .then((db_result) => {
                  db_result.forEach((row) => {
                    Cache.set(`userbot_${row.UserId}_disabled`, true);
                  });

                  return Database.orm.public.Group.where({ GroupId: target })
                    .select("GroupName")
                    .first()
                    .then((db_result) => {
                      Cache.set(`groupName`, db_result?.GroupName);

                      const sendAll = async () => {
                        for (const ref of this.manager.getRefs()) {
                          const user = this.manager.getUser(ref.userId);
                          if (!user) continue;
                          if (Cache.get(`userbot_${user.id}_disabled`))
                            continue;
                          try {
                            await this.manager.sendMessage(
                              ref,
                              target,
                              "/next",
                            );
                          } catch (err: any) {
                            const errMsg = String(err?.message).includes(
                              `You're banned from sending messages in supergroups/channels.`,
                            )
                              ? `userbot mungkin dibatasi Telegram untuk mengirim pesan. Userbot akan mencoba bergabung saat ada pendaftaran dimulai.`
                              : `userbot mungkin diblokir atau belum bergabung dalam grup.`;
                            Utils.sendMessageToAdmin(
                              this.bot,
                              `⚠️ <b>Perhatian!</b>\n<a href='tg://user?id=${Number(user.id)}'>${user.fullName}</a> gagal mengirim perintah /next ke grup, ${errMsg}`,
                            );
                          }
                        }

                        var pesan = `✅ <b>Perintah Terkirim!</b>`;
                        pesan += `\nPerintah /next telah dikirim ke grup tujuan - ${db_result?.GroupName}`;
                        let keyb: any[] = [];
                        keyb[0] = [btn.text(`❌ Batalkan`, `next_cancel_none`)];

                        this.ctx.deleteMessage();
                        Utils.sendMessageToAdmin(this.bot, pesan, keyb);
                      };

                      sendAll();
                    });
                });
            });
            return;
          }
        }

        var pola = /^userbot_(\d+)$/i;
        if ((mc = pola.exec(cbData))) {
          if (!admin.CanManageUbot)
            return this.ctx.answerCallbackQuery({
              text: "⚠️ Akses Ditolak\nAnda tidak diizinkan untuk mengoperasikan ini.",
              show_alert: true,
            });
          const userId = mc[1];
          Utils.writeLog(
            `[${new Date()}] ${Utils.getNames(this.ctx)} - mengubah konfigurasi userbot: ${userId}.\n`,
          );
          const isDisabled = Cache.get(`userbot_${userId}_disabled`);
          const newDisabled = !isDisabled;

          if (newDisabled) {
            Database.orm.public.DisabledUserBot.create({
              UserId: userId,
            });
          } else {
            Database.orm.public.DisabledUserBot.where({
              UserId: userId,
            }).delete();
          }

          Cache.set(`userbot_${userId}_disabled`, newDisabled);

          const message = this.ctx.callbackQuery?.message!;
          const currentKeyboard = message?.reply_markup?.inline_keyboard;

          if (!currentKeyboard) {
            this.ctx.answerCallbackQuery({
              text: "Gagal update, keyboard tidak ditemukan.",
            });
            return;
          }

          const newKeyboard = currentKeyboard.map((row) => {
            return row.map((button) => {
              if (
                "callback_data" in button &&
                button.callback_data === `userbot_${userId}`
              ) {
                const nameOnly = button.text
                  .replace(/\s*[✅❌]\s*$/, "")
                  .trim();
                return {
                  ...button,
                  text: `${nameOnly} ${!newDisabled ? "✅" : "❌"}`,
                };
              }
              return button;
            });
          });

          this.ctx
            .editMessageReplyMarkup({
              reply_markup: { inline_keyboard: newKeyboard },
            })
            .catch(() => {
              this.ctx.editMessageText(`Something went wrong...`).catch(() => {
                this.ctx.reply(`Something went wrong...`);
              });
            });
          this.ctx.answerCallbackQuery().catch(() => {});
          return;
        }

        var pola = /afkmode_(.*)_(.*)/i;
        if ((mc = pola.exec(cbData))) {
          if (!admin.CanManageSmode)
            return this.ctx.answerCallbackQuery({
              text: "⚠️ Akses Ditolak\nAnda tidak diizinkan untuk mengoperasikan ini.",
              show_alert: true,
            });
          const type = mc[1];

          if (type === "return") {
            if (String(Cache.get(`mode`)) !== "afkmode")
              return this.ctx.deleteMessage();
            var pesan = `🧨 <b>Suck Mode</b>`;
            pesan += `\nSuck mode sedang aktif di ${Cache.get(`groupName`)}, apakah Anda ingin menonaktifkannya?\n\nTekan tombol berisikan peran jika Anda ingin peran tersebut otomatis berjalan.\nHari diatur: ${Cache.get(`afkmodeDur`)}`;
            pesan += `\n\n• 🎎 Afk Semua - membuat semua userbot afk hingga permainan berakhir.`;
            pesan += `\n• 🔁 Continuous - aktifkan fitur ini untuk membuat smode berjalan selama mungkin tanpa bergantung pada jumlah hari yang ditentukan.`;

            let keyb: any[] = [];
            keyb.push([
              btn.text(`🗳 Mode Pemilihan`, `afkmode_election_none`),
              btn.text(`🏙 Ganti Hari`, `afkmode_day_none`),
            ]);
            keyb.push(...this.buildRoleButtons("afkmode_role"));
            keyb.push([
              btn.text(
                `🎎 Afk Semua ${Cache.get(`allroleAfk`) ? "✅" : "❌"}`,
                `afkmode_afkrl_none`,
              ),
              btn.text(
                `🔁 Continuous ${Cache.get(`continu`) ? "✅" : "❌"}`,
                `afkmode_conti_none`,
              ),
            ]);
            keyb.push([btn.text(`⛔️ Hentikan`, `afkmode_disable_none`)]);

            this.ctx
              .editMessageText(pesan, {
                parse_mode: "HTML",
                reply_markup: markup.inlineKeyboard(keyb),
              })
              .catch(() => {});
            this.ctx.answerCallbackQuery().catch(() => {});
            return;
          }

          if (type === "afkrl") {
            if (String(Cache.get(`mode`)) !== "afkmode")
              return this.ctx.deleteMessage();
            if (Cache.get(`allroleAfk`)) {
              Cache.del(`allroleAfk`);
            } else {
              Cache.set(`allroleAfk`, true);
            }
            Utils.writeLog(
              `[${new Date()}] ${Utils.getNames(this.ctx)} - mengubah konfigurasi afk semua ke: ${Cache.get(`allroleAfk`) ? "on" : "off"}.\n`,
            );
            let keyb: any[] = [];
            keyb.push([
              btn.text(`🗳 Mode Pemilihan`, `afkmode_election_none`),
              btn.text(`🏙 Ganti Hari`, `afkmode_day_none`),
            ]);
            keyb.push(...this.buildRoleButtons("afkmode_role"));
            keyb.push([
              btn.text(
                `🎎 Afk Semua ${Cache.get(`allroleAfk`) ? "✅" : "❌"}`,
                `afkmode_afkrl_none`,
              ),
              btn.text(
                `🔁 Continuous ${Cache.get(`continu`) ? "✅" : "❌"}`,
                `afkmode_conti_none`,
              ),
            ]);
            keyb.push([btn.text(`⛔️ Hentikan`, `afkmode_disable_none`)]);

            this.ctx
              .editMessageReplyMarkup({
                reply_markup: markup.inlineKeyboard(keyb),
              })
              .catch(() => {});
            this.ctx.answerCallbackQuery().catch(() => {});
            return;
          }

          if (type === "conti") {
            if (String(Cache.get(`mode`)) !== "afkmode")
              return this.ctx.deleteMessage();
            if (Cache.get(`continu`)) {
              Cache.del(`join`);
              Cache.del(`continu`);
            } else {
              Cache.set(`join`, "direct");
              Cache.set(`continu`, true);
            }
            Utils.writeLog(
              `[${new Date()}] ${Utils.getNames(this.ctx)} - mengubah konfigurasi continuous ke: ${Cache.get(`continu`) ? "on" : "off"}.\n`,
            );
            let keyb: any[] = [];
            keyb.push([
              btn.text(`🗳 Mode Pemilihan`, `afkmode_election_none`),
              btn.text(`🏙 Ganti Hari`, `afkmode_day_none`),
            ]);
            keyb.push(...this.buildRoleButtons("afkmode_role"));
            keyb.push([
              btn.text(
                `🎎 Afk Semua ${Cache.get(`allroleAfk`) ? "✅" : "❌"}`,
                `afkmode_afkrl_none`,
              ),
              btn.text(
                `🔁 Continuous ${Cache.get(`continu`) ? "✅" : "❌"}`,
                `afkmode_conti_none`,
              ),
            ]);
            keyb.push([btn.text(`⛔️ Hentikan`, `afkmode_disable_none`)]);

            this.ctx
              .editMessageReplyMarkup({
                reply_markup: markup.inlineKeyboard(keyb),
              })
              .catch(() => {});
            this.ctx.answerCallbackQuery().catch(() => {});
            return;
          }

          if (type === "day") {
            if (String(Cache.get(`mode`)) !== "afkmode")
              return this.ctx.deleteMessage();
            if (String(Cache.get(`mode`)) === "afkmode") {
              this.ctx.deleteMessage();
              this.ctx.answerCallbackQuery({
                text: "⚠️ Suck mode sudah aktif.",
                show_alert: true,
              });
              return;
            }
            var pesan = `❇️ <b>Masukkan Angka</b>`;
            pesan += `\nBerapa lama Anda ingin ngehama?\nSaat ini: ${Cache.get(`afkmodeDur`)} hari.`;
            let keyb = [];
            keyb[0] = [btn.text(`❌ Batal`, `afkmode_return_none`)];

            Cache.set(`smode_session_${chat?.id}`, true);
            this.ctx
              .editMessageText(pesan, {
                parse_mode: "HTML",
                reply_markup: markup.inlineKeyboard(keyb),
              })
              .catch(() => {});
            this.ctx.answerCallbackQuery().catch(() => {});
            return;
          }

          if (type === "role") {
            if (String(Cache.get(`mode`)) !== "afkmode")
              return this.ctx.deleteMessage();
            if (!Cache.get(`afkmode${mc[2]}`)) {
              Cache.set(`afkmode${mc[2]}`, true);
            } else {
              Cache.del(`afkmode${mc[2]}`);
            }
            Utils.writeLog(
              `[${new Date()}] ${Utils.getNames(this.ctx)} - mengubah role ${mc[2]} ke ${Cache.get(`afkmode${mc[2]}`) ? "manual" : "otomatis"}.\n`,
            );
            let keyb: any[] = [];
            keyb.push([
              btn.text(`🗳 Mode Pemilihan`, `afkmode_election_none`),
              btn.text(`🏙 Ganti Hari`, `afkmode_day_none`),
            ]);
            keyb.push(...this.buildRoleButtons("afkmode_role"));
            keyb.push([
              btn.text(
                `🎎 Afk Semua ${Cache.get(`allroleAfk`) ? "✅" : "❌"}`,
                `afkmode_afkrl_none`,
              ),
              btn.text(
                `🔁 Continuous ${Cache.get(`continu`) ? "✅" : "❌"}`,
                `afkmode_conti_none`,
              ),
            ]);
            keyb.push([btn.text(`⛔️ Hentikan`, `afkmode_disable_none`)]);

            this.ctx
              .editMessageReplyMarkup({
                reply_markup: markup.inlineKeyboard(keyb),
              })
              .catch(() => {});
            this.ctx.answerCallbackQuery().catch(() => {});
            return;
          }

          if (type === "rlset") {
            if (String(Cache.get(`mode`)) === "afkmode") {
              this.ctx.deleteMessage();
              this.ctx.answerCallbackQuery({
                text: "⚠️ Suck mode sudah aktif.",
                show_alert: true,
              });
              return;
            }
            var pesan = `🎎 <b>Peran</b>`;
            pesan += `\nApakah Anda ingin peran berikut dikendalikan bot atau manual? Anda juga dapat mengubahnya nanti.`;

            let keyb: any[] = [];
            keyb.push(...this.buildRoleButtons("afkmode_rolst"));
            keyb.push([btn.text(`❌ Batal`, `cancel_`)]);
            keyb.push([
              btn.text(`⬅️ Kembali`, `afkmode_election_none`),
              btn.text(`Aktifkan ➡️`, `afkmode_active_none`),
            ]);

            this.ctx
              .editMessageText(pesan, {
                parse_mode: "HTML",
                reply_markup: markup.inlineKeyboard(keyb),
              })
              .catch(() => {});
            this.ctx.answerCallbackQuery().catch(() => {});
            return;
          }

          if (type === "rolst") {
            if (String(Cache.get(`mode`)) === "afkmode") {
              this.ctx.deleteMessage();
              this.ctx.answerCallbackQuery({
                text: "⚠️ Suck mode sudah aktif.",
                show_alert: true,
              });
              return;
            }
            if (!Cache.get(`afkmode${mc[2]}`)) {
              Cache.set(`afkmode${mc[2]}`, true);
            } else {
              Cache.del(`afkmode${mc[2]}`);
            }
            let keyb: any[] = [];
            keyb.push(...this.buildRoleButtons("afkmode_rolst"));
            keyb.push([btn.text(`❌ Batal`, `cancel_`)]);
            keyb.push([
              btn.text(`⬅️ Kembali`, `afkmode_election_none`),
              btn.text(`Aktifkan ➡️`, `afkmode_active_none`),
            ]);

            this.ctx
              .editMessageReplyMarkup({
                reply_markup: markup.inlineKeyboard(keyb),
              })
              .catch(() => {});
            this.ctx.answerCallbackQuery().catch(() => {});
            return;
          }

          if (type === "vote") {
            if (Cache.get(`vote_type`) === mc[2])
              return this.ctx.answerCallbackQuery();
            Cache.set(`vote_type`, mc[2]);
            let keyb = [];
            keyb[0] = [
              btn.text(
                `Gunakan ${mc[2] === "yes" ? "✅" : ""}`,
                `afkmode_vote_yes`,
              ),
              btn.text(
                `Lewati ${mc[2] === "no" ? "✅" : ""}`,
                `afkmode_vote_no`,
              ),
            ];
            if (!Cache.get(`mode`)) {
              keyb[1] = [
                btn.text(`❌ Batal`, !Cache.get(`mode`) ? `cancel_` : `close_`),
                btn.text(
                  Cache.get(`mode`) ? `Simpan ➡️` : `Lanjut ➡️`,
                  Cache.get(`mode`)
                    ? `afkmode_active_none`
                    : `afkmode_rlset_none`,
                ),
              ];
            } else {
              Utils.writeLog(
                `[${new Date()}] ${Utils.getNames(this.ctx)} - mengubah konfigurasi vote ke: ${mc[2] === "yes" ? "gunakan" : "lewati"}.\n`,
              );
              keyb[1] = [btn.text(`⬅️ Kembali`, `afkmode_return_none`)];
            }

            Cache.set(`useVote`, mc[2]);
            this.ctx
              .editMessageReplyMarkup({
                reply_markup: markup.inlineKeyboard(keyb),
              })
              .catch(() => {});
            this.ctx.answerCallbackQuery().catch(() => {});
            return;
          }

          if (type === "election") {
            if (!Cache.get(`useVote`)) {
              Cache.set(`useVote`, "yes");
            }
            var pesan = `🗳 <b>Mode Pemilihan</b>`;
            pesan += `\nApakah Anda ingin melewati pemilihan? jika ya, maka semua userbot akan memilih target acak dari daftar userbot (target ditentukan apabila dia tidak memiliki peran aktif).`;
            let keyb = [];
            keyb[0] = [
              btn.text(
                `Gunakan ${Cache.get(`useVote`) === "yes" ? "✅" : ""}`,
                `afkmode_vote_yes`,
              ),
              btn.text(
                `Lewati ${Cache.get(`useVote`) === "no" ? "✅" : ""}`,
                `afkmode_vote_no`,
              ),
            ];
            if (!Cache.get(`mode`)) {
              keyb[1] = [
                btn.text(`❌ Batal`, !Cache.get(`mode`) ? `cancel_` : `close_`),
                btn.text(
                  Cache.get(`mode`) ? `Simpan ➡️` : `Lanjut ➡️`,
                  Cache.get(`mode`)
                    ? `afkmode_active_none`
                    : `afkmode_rlset_none`,
                ),
              ];
            } else {
              keyb[1] = [btn.text(`⬅️ Kembali`, `afkmode_return_none`)];
            }

            this.ctx
              .editMessageText(pesan, {
                parse_mode: "HTML",
                reply_markup: markup.inlineKeyboard(keyb),
              })
              .catch(() => {});
            this.ctx.answerCallbackQuery().catch(() => {});
            return;
          }

          if (type === "active") {
            if (String(Cache.get(`mode`)) === "afkmode") {
              this.ctx.deleteMessage();
              this.ctx.answerCallbackQuery({
                text: "⚠️ Suck mode sudah aktif.",
                show_alert: true,
              });
              return;
            }
            if (!Cache.get(`useVote`))
              return this.ctx.answerCallbackQuery({
                text: "⚠️ Pilih mode pemilihan terlebih dahulu.",
                show_alert: true,
              });
            Cache.set(`mode`, "afkmode");
            this.ctx.deleteMessage().catch(() => {});
            Utils.writeLog(
              `[${new Date()}] ${Utils.getNames(this.ctx)} - mengaktifkan suck mode di: ${Cache.get(`groupName`)}.\n`,
            );
            Utils.sendMessageToAdmin(
              this.bot,
              `✅ <b>Suck Mode Diaktifkan!</b>\nSuck mode telah diaktifkan di ${Cache.get(`groupName`)}, userbot akan bertahan hingga hari ke-${Cache.get(`afkmodeDur`)}, Anda akan diberitahu tentang peran semua userbot.`,
            );
            return;
          }

          if (type === "disable") {
            if (String(Cache.get(`mode`)) !== "afkmode") {
              this.ctx.deleteMessage();
              this.ctx.answerCallbackQuery({
                text: "⚠️ Suck mode tidak aktif.",
                show_alert: true,
              });
              return;
            }
            var pesan = `⚠️ <b>Perhatian!</b>\nApakah Anda yakin ingin menonaktifkan suck mode di ${Cache.get(`groupName`)}?`;
            let keyb = [];
            keyb[0] = [
              btn.text(`✅ Ya`, `afkmode_disableC_none`),
              btn.text(`❌ Tidak`, `afkmode_return_none`),
            ];

            this.ctx
              .editMessageText(pesan, {
                parse_mode: "HTML",
                reply_markup: markup.inlineKeyboard(keyb),
              })
              .catch(() => {});
            this.ctx.answerCallbackQuery().catch(() => {});
            return;
          }

          if (type === "disableC") {
            if (String(Cache.get(`mode`)) !== "afkmode") {
              this.ctx.deleteMessage();
              this.ctx.answerCallbackQuery({
                text: "⚠️ Suck mode tidak aktif.",
                show_alert: true,
              });
              return;
            }
            Utils.writeLog(
              `[${new Date()}] ${Utils.getNames(this.ctx)} - menonaktifkan suck mode di ${Cache.get(`groupName`)}.\n`,
            );
            UserBots.clearSmode();
            this.ctx.deleteMessage();
            Utils.sendMessageToAdmin(
              this.bot,
              `✅ <b>Suck Mode Dimatikan!</b>\nUserbot akan afk hingga permainan berakhir.`,
            );
          }
        }
      });
  }
}
