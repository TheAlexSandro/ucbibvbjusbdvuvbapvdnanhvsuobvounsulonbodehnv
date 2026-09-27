import type { Bot, Context } from "grammy";
import { Utils } from "../Utils/Utils";
import { TelegramClient, Api } from "teleproto";
import { markup, btn } from "../Utils/Buttons";
import { Cache } from "../Utils/Caches";
import { Database } from "../prisma/Database";
import { UserBots } from "../Utils/UserBots";

export class BotHandle {
  bot: Bot;
  ctx: Context;
  clients: TelegramClient[];

  constructor(bot: Bot, ctx: Context, clients: TelegramClient[]) {
    this.bot = bot;
    this.ctx = ctx;
    this.clients = clients;
  }

  private static readonly ROLES = [
    { emoji: "🕵️‍♂️", label: "Detective", cacheKey: "afkmodeDet", action: "Det" },
    { emoji: "💃", label: "Hooker", cacheKey: "afkmodeHook", action: "Hook" },
    { emoji: "🔪", label: "Maniac", cacheKey: "afkmodeMani", action: "Mani" },
    { emoji: "🎅", label: "Santa", cacheKey: "afkmodeSanta", action: "Santa" },
  ];

  private buildRoleButtons(callbackPrefix: string): any[] {
    return BotHandle.ROLES.map((role) => [
      btn.text(
        `${role.emoji} ${role.label} ${Cache.get(role.cacheKey) ? "(otomatis)" : "(manual)"}`,
        `${callbackPrefix}_${role.action}`,
      ),
    ]);
  }

  public message() {
    const chat = this.ctx.chat;
    const admins = String(process.env["ADMIN"]).split(",");
    const isAdmin = admins.find((id: string) => id === String(chat?.id));

    if (!isAdmin) return this.ctx.reply(`⚠️ Access Denied.`);
    var pola = /^\/start$/i;
    if (pola.exec(this.ctx.message?.text!)) {
      var pesan = `👋 Halo ${Utils.getName(this.ctx)}, selamat datang di controller!`;
      pesan += `\nKelola userbot Anda di sini.`;
      pesan += `\n\n🕹 <b>Perintah:</b>`;
      pesan += `\n• /gc - tambahkan grup atau kelola grup yang sudah ada.`;
      pesan += `\n• /next - gunakan perintah ini untuk memicu semua userbot mengirim <code>/next</code> ke grup.`;
      pesan += `\n• /smode - (suck mode) gunakan perintah ini untuk membuat userbot bertahan hingga hari yang ditentukan, <b>salah satu userbot harus memiliki peran dokter</b>.`;
      pesan += `\n• /ubot - kelola userbot mana yang akan digunakan.`;
      pesan += `\n• /reset - (berbahaya!) gunakan perintah ini untuk menghapus semua cache.`;

      this.ctx.reply(pesan, { parse_mode: "HTML" });
      return;
    }

    var pola = /^\/gc$/i;
    if (pola.exec(this.ctx.message?.text!)) {
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

    var pola = /^\/ubot$/i;
    if (pola.exec(this.ctx.message?.text!)) {
      this.ctx.reply(`⏳ Memproses...`).then((result) => {
        Database.orm.public.DisabledUserBot.select("UserId")
          .all()
          .then((db_result) => {
            const disabledSet = new Set(
              db_result.map((row) => row.UserId.toString()),
            );
            var pesan = `🤖 <b>Daftar Bot</b>`;
            pesan += `\nKelola userbot mana yang ingin Anda gunakan atau matikan.`;

            const keyb: any[] = [];
            let index = 0;

            const processNext = () => {
              if (index >= this.clients.length) {
                this.ctx.api.editMessageText(
                  result.chat.id,
                  result.message_id,
                  pesan,
                  {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: keyb },
                  },
                );
                return;
              }
              const client = this.clients[index];

              client
                .getMe()
                .then((me) => {
                  const isDisabled = disabledSet.has(me.id.toString());

                  keyb.push([
                    btn.text(
                      `${me.lastName ? `${me.firstName} ${me.lastName}` : me.firstName} ${!isDisabled ? "✅" : "❌"}`,
                      `userbot_${String(me.id)}`,
                    ),
                  ]);

                  index++;
                  processNext();
                })
                .catch(() => {
                  index++;
                  processNext();
                });
            };

            processNext();
          });
      });
      return;
    }

    var pola = /^\/next$/i;
    if (pola.exec(this.ctx.message?.text!)) {
      if (Cache.get(`join`))
        return this.ctx.reply(
          `⚠️ <b>Perhatian!</b>\nHanya 1 grup setiap saat.`,
        );
      this.ctx.reply(`⏳ Memproses...`).then((result) => {
        var pesan = `👥 <b>Pilih Grup</b>`;
        pesan += `\nPilih grup di mana Anda ingin mengirim perintah /next`;
        pesan += `\nNama grup tidak terbaru? Tekan tombol refresh.`;
        Database.orm.public.Group.all().then((db_result) => {
          let keyb = [];

          for (var i = 0; i < db_result.length; i++) {
            keyb.push([
              btn.text(db_result[i].GroupName, `next_${db_result[i].GroupId}`),
            ]);
          }
          keyb.push([btn.text(`🔄 Refresh`, `next_refresh`)]);

          this.bot.api.editMessageText(chat?.id!, result.message_id, pesan, {
            parse_mode: "HTML",
            reply_markup: markup.inlineKeyboard(keyb),
          });
        });
      });
      return;
    }

    var pola = /^\/smode$/i;
    if (pola.exec(this.ctx.message?.text!)) {
      if (!Cache.get(`group_name`))
        return this.ctx.reply(`⚠️ Belum ada grup yang ditentukan.`);
      if (!Cache.get(`begins`))
        return this.ctx.reply(`⚠️ Permainan belum dimulai.`);
      this.ctx.reply(`⏳ Memproses...`).then((result) => {
        if (Cache.get("mode") === "afkmode") {
          var pesan = `🧨 <b>Suck Mode</b>`;
          pesan += `\nSuck mode sedang aktif, apakah Anda ingin menonaktifkannya?\n\nTekan tombol berisikan peran jika Anda ingin peran tersebut otomatis berjalan.\nHari diatur: ${Cache.get(`afkmodeDur`)}`;
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
          keyb.push([btn.text(`❌ Hentikan`, `afkmode_disable_none`)]);

          this.bot.api.editMessageText(chat?.id!, result.message_id, pesan, {
            parse_mode: "HTML",
            reply_markup: markup.inlineKeyboard(keyb),
          });
          return;
        }

        Cache.set(`afkmodeHook`, true);
        Cache.set(`afkmodeDet`, true);
        Cache.set(`afkmodeMani`, true);
        Cache.set(`afkmodeSanta`, true);
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
      var pesan = `⚠️ <b>Perhatian!</b>`;
      pesan += `\nApakah Anda ingin menghapus semua cache? suck mode yang aktif, next yang sudah dikirim akan terdampak.`;
      let keyb = [];
      keyb[0] = [btn.text(`❌ Batal`, `close_`), btn.text(`✅ Ya`, `reset_`)];
      this.ctx.reply(pesan, {
        parse_mode: "HTML",
        reply_markup: markup.inlineKeyboard(keyb),
      });
      return;
    }

    // SESSION
    const getSmodeSession = Cache.get(`smode_session_${chat?.id}`);
    const getAddgcSession = Cache.get(`session_addgc_${chat?.id}`);
    if (getSmodeSession) {
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
        if (Number(this.ctx.message?.text) < Number(Cache.get(`dayNow`) ?? 0))
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
      this.ctx
        .reply(`⏳ Mencari informasi dari salah satu userbot...`)
        .then((message_result) => {
          const processNext = (i: number): void => {
            if (i >= this.clients.length) {
              this.ctx.api.editMessageText(
                message_result.chat.id,
                message_result.message_id,
                `❌ <b>Gagal!</b>\nTidak ada userbot yang bisa mendapatkan info grup tersebut, silahkan periksa:\n• Apakah grup tersebut ada?\n• Jika privat, Anda harus menambahkan salah 1 userbot ke sana.`,
                { parse_mode: "HTML" },
              );
              return;
            }

            this.clients[i]
              .getEntity(String(this.ctx.message?.text!))
              .then((entity: any) => {
                return this.clients[i].getParticipants(entity).then((prtc) => {
                  Cache.del(`session_addgc_${chat?.id}`);
                  const groupId = `-100${String(entity.id)}`;

                  let pesan = `✅ <b>Ditambahkan</b>`;
                  pesan += `\nGrup telah ditambahkan, berikut informasinya:`;
                  pesan += `\n\nNama: ${entity.title ?? "-"}`;
                  pesan += `\nID: <code>${groupId}</code>`;
                  pesan += `\nUsername: ${entity.username ? `@${entity.username}` : "-"}`;
                  pesan += `\nPeserta: ${prtc.total ?? "-"}`;

                  Database.orm.public.Group.create({
                    GroupId: groupId,
                    GroupName: entity.title,
                  });
                  this.ctx.api.editMessageText(
                    message_result.chat.id,
                    message_result.message_id,
                    pesan,
                    { parse_mode: "HTML" },
                  );
                });
              })
              .catch(() => {
                processNext(i + 1);
              });
          };

          processNext(0);
        });
      return;
    }
  }

  public callback() {
    const chat = this.ctx.chat;
    const callback = this.ctx.callbackQuery;
    const cbData = String(callback?.data);
    let mc;

    var pola = /^regis_cancel$/i;
    if (pola.exec(cbData)) {
      this.ctx.deleteMessage();
      if (!Cache.get(`join`)) {
        this.ctx.answerCallbackQuery({ text: `Nothing`, show_alert: true });
        return;
      }
      Cache.del(`join`);
      Utils.sendMessageToAdmin(
        this.bot,
        `❌ <b>Pendaftaran Dibatalkan!</b>\nUserbot tidak akan bergabung dalam permainan.`,
      );
      return;
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
      Cache.flushAll();
      this.ctx.editMessageText(
        `✅ <b>Berhasil!</b>\nSemua cache telah dihapus.`,
      );
      return;
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
        return;
      }

      if (type === "del") {
        Database.orm.public.Group.where({ GroupId: groupId })
          .delete()
          .then(() => {
            let keyb = [];
            Database.orm.public.Group.all().then((db_result) => {
              if (db_result.length <= 0) {
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

              for (var i = 0; i < db_result.length; i++) {
                keyb.push([
                  btn.text(db_result[i].GroupName, `nothing`),
                  btn.text(`🗑`, `group_del_${db_result[i].GroupId}`),
                ]);
              }
              keyb.push([btn.text(`⬅️ Return`, `group_return_none`)]);

              this.ctx.editMessageReplyMarkup({
                reply_markup: markup.inlineKeyboard(keyb),
              });
            });
          });
        return;
      }
    }

    var pola = /^next_(.*)$/i;
    if ((mc = pola.exec(cbData))) {
      const type = mc[1];

      if (type === "refresh") {
        this.ctx.editMessageText(`⏳ Memproses...`);
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
                    keyb[0] = [btn.text(`⬅️ Kembali`, `next_return`)];
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
                  } else {
                    this.ctx.editMessageText(
                      `❌ <b>Gagal!</b>\nTidak ada userbot yang bisa mendapatkan info grup tersebut, salah 1 grup tidak tersedia atau userbot tidak berada dalam grup tersebut.`,
                      { parse_mode: "HTML" },
                    );
                  }
                  return;
                }

                const groupId = dbResult[groupIndex].GroupId;

                const tryClient = (clientIndex: number): void => {
                  if (clientIndex >= this.clients.length) {
                    failCount++;
                    processGroup(groupIndex + 1);
                    return;
                  }

                  this.clients[clientIndex]
                    .getEntity(groupId)
                    .then((entity: any) => {
                      return Database.orm.public.Group.where({
                        GroupId: groupId,
                      })
                        .update({ GroupName: String(entity.title) })
                        .then(() => {
                          successCount++;
                          processGroup(groupIndex + 1);
                        });
                    })
                    .catch(() => {
                      tryClient(clientIndex + 1);
                    });
                };

                tryClient(0);
              };

              processGroup(0);
            });
        };

        updateAllGroupNames();
        return;
      }

      if (type === "return") {
        this.ctx.editMessageText(`⏳ Memproses...`);
        var pesan = `👥 <b>Pilih Grup</b>`;
        pesan += `\nPilih grup di mana Anda ingin mengirim perintah /next`;
        pesan += `\nNama grup tidak terbaru? Tekan tombol refresh.`;
        Database.orm.public.Group.all().then((db_result) => {
          let keyb = [];

          for (var i = 0; i < db_result.length; i++) {
            keyb.push([
              btn.text(db_result[i].GroupName, `next_${db_result[i].GroupId}`),
            ]);
          }
          keyb.push([btn.text(`🔄 Refresh`, `next_refresh`)]);

          this.ctx.editMessageText(pesan, {
            parse_mode: "HTML",
            reply_markup: markup.inlineKeyboard(keyb),
          });
        });
        return;
      }

      if (type.startsWith("-100")) {
        this.ctx.editMessageText(`⏳ Memproses...`);
        const target = mc[1];
        Cache.set(`group_target`, target);
        Cache.set(`join`, true);

        Database.orm.public.DisabledUserBot.select("UserId")
          .all()
          .then((db_result) => {
            db_result.map((id) => {
              Cache.set(`userbot_${id}_disabled`, true);
            });

            return Database.orm.public.Group.where({ GroupId: target })
              .select("GroupName")
              .first()
              .then((db_result) => {
                Cache.set(`group_name`, db_result?.GroupName);

                const processNext = (i: number): void => {
                  if (i >= this.clients.length) {
                    var pesan = `✅ <b>Perintah Terkirim!</b>`;
                    pesan += `\nPerintah /next telah dikirim ke grup tujuan - ${db_result?.GroupName}`;
                    let keyb: any[] = [];
                    keyb[0] = [btn.text(`❌ Batalkan`, `regis_cancel`)];

                    this.ctx.deleteMessage();
                    Utils.sendMessageToAdmin(this.bot, pesan, keyb);
                    return;
                  }

                  this.clients[i]
                    .getMe()
                    .then((entity) => {
                      return this.clients[i]
                        .getEntity(target)
                        .then((chat_result) => {
                          const isDisabled = Cache.get(
                            `userbot_${String(entity.id)}_disabled`,
                          );
                          if (isDisabled) return;
                          return this.clients[i]
                            .sendMessage(chat_result, {
                              message: "/next",
                            })
                            .catch((err) => {
                              const fullName = entity.lastName
                                ? `${entity.firstName} ${entity.lastName}`
                                : entity.firstName;
                              const errMsg = err.message.includes(
                                `You're banned from sending messages in supergroups/channels.`,
                              )
                                ? `userbot mungkin dibatasi Telegram untuk mengirim pesan. Userbot akan mencoba bergabung saat ada pendaftaran dimulai.`
                                : `userbot mungkin diblokir atau belum bergabung dalam grup.`;

                              Utils.sendMessageToAdmin(
                                this.bot,
                                `⚠️ <b>Perhatian!</b>\n<a href='tg://user?id=${Number(entity.id)}'>${fullName}</a> gagal mengirim perintah /next ke grup, ${errMsg}`,
                              );
                            });
                        });
                    })
                    .finally(() => {
                      processNext(i + 1);
                    });
                };

                processNext(0);
              });
          });
        return;
      }
    }

    var pola = /^userbot_(\d+)$/i;
    if ((mc = pola.exec(cbData))) {
      const userId = mc[1];
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
            const nameOnly = button.text.replace(/\s*[✅❌]\s*$/, "").trim();
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
      const type = mc[1];

      if (type === "return") {
        var pesan = `🧨 <b>Suck Mode</b>`;
        pesan += `\nSuck mode sedang aktif, apakah Anda ingin menonaktifkannya?\n\nTekan tombol berisikan peran jika Anda ingin peran tersebut otomatis berjalan.\nHari diatur: ${Cache.get(`afkmodeDur`)}`;
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
        keyb.push([btn.text(`❌ Hentikan`, `afkmode_disable_none`)]);

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
        if (Cache.get(`allroleAfk`)) {
          Cache.del(`allroleAfk`);
        } else {
          Cache.set(`allroleAfk`, true);
        }
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
        keyb.push([btn.text(`❌ Hentikan`, `afkmode_disable_none`)]);

        this.ctx
          .editMessageReplyMarkup({
            reply_markup: markup.inlineKeyboard(keyb),
          })
          .catch(() => {});
        this.ctx.answerCallbackQuery().catch(() => {});
        return;
      }

      if (type === "conti") {
        if (Cache.get(`continu`)) {
          Cache.del(`continu`);
        } else {
          Cache.set(`continu`, true);
        }
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
        keyb.push([btn.text(`❌ Hentikan`, `afkmode_disable_none`)]);

        this.ctx
          .editMessageReplyMarkup({
            reply_markup: markup.inlineKeyboard(keyb),
          })
          .catch(() => {});
        this.ctx.answerCallbackQuery().catch(() => {});
        return;
      }

      if (type === "day") {
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
        if (!Cache.get(`afkmode${mc[2]}`)) {
          Cache.set(`afkmode${mc[2]}`, true);
        } else {
          Cache.del(`afkmode${mc[2]}`);
        }
        let keyb: any[] = [];
        keyb.push([btn.text(`🗳 Mode Pemilihan`, `afkmode_election_none`)]);
        keyb.push([btn.text(`🏙 Ganti Hari`, `afkmode_day_none`)]);
        keyb.push(...this.buildRoleButtons("afkmode_role"));
        keyb.push([
          btn.text(
            `🎎 Afk Semua ${Cache.get(`allroleAfk`) ? "✅" : "❌"}`,
            `afkmode_afkrl_none`,
          ),
        ]);
        keyb.push([
          btn.text(
            `🔁 Continuous ${Cache.get(`continu`) ? "✅" : "❌"}`,
            `afkmode_conti_none`,
          ),
        ]);
        keyb.push([btn.text(`❌ Hentikan`, `afkmode_disable_none`)]);

        this.ctx
          .editMessageReplyMarkup({
            reply_markup: markup.inlineKeyboard(keyb),
          })
          .catch(() => {});
        this.ctx.answerCallbackQuery().catch(() => {});
        return;
      }

      if (type === "rlset") {
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
          btn.text(`Lewati ${mc[2] === "no" ? "✅" : ""}`, `afkmode_vote_no`),
        ];
        keyb[1] = [
          btn.text(`❌ Batal`, !Cache.get(`mode`) ? `cancel_` : `close_`),
          btn.text(
            Cache.get(`mode`) ? `Simpan ➡️` : `Lanjut ➡️`,
            Cache.get(`mode`) ? `afkmode_active_none` : `afkmode_rlset_none`,
          ),
        ];

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
        keyb[1] = [
          btn.text(`❌ Batal`, !Cache.get(`mode`) ? `cancel_` : `close_`),
          btn.text(
            Cache.get(`mode`) ? `Simpan ➡️` : `Lanjut ➡️`,
            Cache.get(`mode`) ? `afkmode_active_none` : `afkmode_rlset_none`,
          ),
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

      if (type === "active") {
        if (!Cache.get(`useVote`))
          return this.ctx.answerCallbackQuery({
            text: "⚠️ Pilih mode pemilihan terlebih dahulu.",
            show_alert: true,
          });
        Cache.set(`mode`, "afkmode");
        this.ctx.deleteMessage().catch(() => {});
        Utils.sendMessageToAdmin(
          this.bot,
          `✅ <b>Suck Mode Diaktifkan!</b>\nSuck mode telah diaktifkan di ${Cache.get(`group_name`)}, userbot akan bertahan hingga hari ke-${Cache.get(`afkmodeDur`)}, Anda akan diberitahu tentang peran semua userbot.`,
        );
        return;
      }

      if (type === "disable") {
        UserBots.clearSmode();
        this.ctx.deleteMessage();
        Utils.sendMessageToAdmin(
          this.bot,
          `✅ <b>Suck Mode Dimatikan!</b>\nUserbot akan afk hingga permainan berakhir.`,
        );
        return;
      }
    }
  }
}
