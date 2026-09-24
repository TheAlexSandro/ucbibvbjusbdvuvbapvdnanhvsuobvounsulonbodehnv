import type { Bot, Context } from "grammy";
import { Utils } from "../Utils/Utils";
import { Api, TelegramClient } from "teleproto";
import { markup, btn } from "../Types/Buttons";
import { InlineKeyboardButton } from "grammy/types";
import { Cache } from "../Utils/Caches";

export class BotHandle {
  bot: Bot;
  ctx: Context;
  clients: TelegramClient[];
  constructor(bot: Bot, ctx: Context, clients: TelegramClient[]) {
    this.bot = bot;
    this.ctx = ctx;
    this.clients = clients;
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
      pesan += `\n• /next - gunakan perintah ini untuk memicu semua userbot mengirim <code>/next</code> ke grup.`;
      pesan += `\n• /smode - (suck mode) gunakan perintah ini untuk membuat userbot bertahan hingga hari ke-51, <b>salah satu userbot harus memiliki peran dokter</b>.`;
      pesan += `\n• /reset - (berbahaya!) gunakan perintah ini untuk menghapus semua cache.`;

      this.ctx.reply(pesan, { parse_mode: "HTML" });
      return;
    }

    var pola = /^\/next$/i;
    if (pola.exec(this.ctx.message?.text!)) {
      this.ctx.reply(`⏳ Memproses...`).then((result) => {
        if (!Cache.get(`join`)) {
          Cache.set(`join`, true);
        }
        const targetId = String(process.env["MAFIA_GC"]);
        const processNext = (i: number): void => {
          if (i >= this.clients.length) {
            var pesan = `✅ <b>Perintah Terkirim!</b>`;
            pesan += `\nPerintah /next telah dikirim ke grup tujuan.`;

            this.bot.api.deleteMessage(chat!.id, result.message_id);
            Utils.sendMessageToAdmin(this.bot, pesan);
            return;
          }

          this.clients[i]
            .getEntity(targetId)
            .then((chat_result) => {
              return this.clients[i].sendMessage(chat_result, {
                message: "/next",
              });
            })
            .catch((err) => {
              this.clients[i].getMe().then((entity) => {
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
            })
            .finally(() => {
              processNext(i + 1);
            });
        };

        processNext(0);
      });
      return;
    }

    var pola = /^\/smode$/i;
    if (pola.exec(this.ctx.message?.text!)) {
      this.ctx.reply(`⏳ Memproses...`).then((result) => {
        if (Cache.get("mode") === "afkmode") {
          var pesan = `🧨 <b>Suck Mode</b>`;
          pesan += `\nSuck mode sedang aktif, apakah Anda ingin menonaktifkannya?\n\nTekan tombol berisikan peran jika Anda ingin peran tersebut otomatis berjalan.`;

          let keyb: any[] = [];
          keyb[0] = [btn.text(`🗳 Mode Pemilihan`, `afkmode_election_none`)];
          keyb[1] = [btn.text(`🏙 Ganti Hari`, `afkmode_day_none`)];
          keyb[2] = [
            btn.text(
              `🕵️‍♂️ Detective ${Cache.get(`afkmodeDet`) ? "(otomatis)" : "(manual)"}`,
              `afkmode_role_Det`,
            ),
          ];
          keyb[3] = [
            btn.text(
              `💃 Hooker ${Cache.get(`afkmodeHook`) ? "(otomatis)" : "(manual)"}`,
              `afkmode_role_Hook`,
            ),
          ];
          keyb[4] = [btn.text(`❌ Hentikan`, `afkmode_disable_none`)];

          this.bot.api.editMessageText(chat?.id!, result.message_id, pesan, {
            parse_mode: "HTML",
            reply_markup: markup.inlineKeyboard(keyb),
          });
          return;
        }

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
      Cache.flushAll();
      this.ctx.reply(`✅ <b>Cache Direset!</b>\nSemua cache telah dihapus.`, {
        parse_mode: "HTML",
      });
      return;
    }

    // SESSION
    const getSmodeSession = Cache.get(`smode_session_${chat?.id}`);
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
          btn.text(`Gunakan`, `afkmode_vote_yes`),
          btn.text(`Lewati`, `afkmode_vote_no`),
        ];
        keyb[1] = [
          btn.text(`❌ Batal`, `cancel_`),
          btn.text(`Lanjut ➡️`, `afkmode_rlset_none`),
        ];
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
  }

  public callback() {
    const chat = this.ctx.chat;
    const callback = this.ctx.callbackQuery;
    const cbData = String(callback?.data);

    var pola = /^cancel_/i;
    if (pola.exec(cbData)) {
      Cache.del(`useVote`);
      Cache.del(`mode`);
      Cache.del(`smode_session_${this.ctx.chat?.id}`);
      Cache.del(`afkmodeDet`);
      Cache.del(`afkmodeHook`);
      this.ctx.editMessageText(`❌ <b>Dibatalkan!</b>`, {
        parse_mode: "HTML",
      });
      return;
    }

    var pola = /^close_/i;
    if (pola.exec(cbData)) {
      this.ctx.deleteMessage().catch(() => {});
      return;
    }

    var pola = /afkmode_(.*)_(.*)/i;
    let mc;
    if ((mc = pola.exec(cbData))) {
      const type = mc[1];

      if (type === "return") {
        var pesan = `🧨 <b>Suck Mode</b>`;
        pesan += `\nSuck mode sedang aktif, apakah Anda ingin menonaktifkannya?\n\nTekan tombol berisikan peran jika Anda ingin peran tersebut otomatis berjalan.`;

        let keyb: any[] = [];
        keyb[0] = [btn.text(`🗳 Mode Pemilihan`, `afkmode_election_none`)];
        keyb[1] = [btn.text(`🏙 Ganti Hari`, `afkmode_day_none`)];
        keyb[2] = [
          btn.text(
            `🕵️‍♂️ Detective ${Cache.get(`afkmodeDet`) ? "(otomatis)" : "(manual)"}`,
            `afkmode_role_Det`,
          ),
        ];
        keyb[3] = [
          btn.text(
            `💃 Hooker ${Cache.get(`afkmodeHook`) ? "(otomatis)" : "(manual)"}`,
            `afkmode_role_Hook`,
          ),
        ];
        keyb[4] = [btn.text(`❌ Hentikan`, `afkmode_disable_none`)];

        this.ctx
          .editMessageText(pesan, {
            parse_mode: "HTML",
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
        const getRoleList = String(Cache.get(`role`));
        if (!Cache.get(`afkmode${mc[2]}`)) {
          Cache.set(`afkmode${mc[2]}`, true);
        } else {
          Cache.del(`afkmode${mc[2]}`);
        }
        let keyb: any[] = [];
        keyb.push([btn.text(`🗳 Mode Pemilihan`, `afkmode_election_none`)]);
        if (getRoleList.toLowerCase().includes("detective")) {
          keyb.push([
            btn.text(
              `🕵️‍♂️ Detective ${Cache.get(`afkmodeDet`) ? "(otomatis)" : "(manual)"}`,
              `afkmode_role_Det`,
            ),
          ]);
        }
        if (getRoleList.toLowerCase().includes("hooker")) {
          keyb.push([
            btn.text(
              `💃 Hooker ${Cache.get(`afkmodeHook`) ? "(otomatis)" : "(manual)"}`,
              `afkmode_role_Hook`,
            ),
          ]);
        }
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
        keyb[0] = [
          btn.text(
            `🕵️‍♂️ Detective ${Cache.get(`afkmodeDet`) ? "(otomatis)" : "(manual)"}`,
            `afkmode_rolst_Det`,
          ),
        ];
        keyb[1] = [
          btn.text(
            `💃 Hooker ${Cache.get(`afkmodeHook`) ? "(otomatis)" : "(manual)"}`,
            `afkmode_rolst_Hook`,
          ),
        ];
        keyb[2] = [btn.text(`❌ Batal`, `cancel_`)];
        keyb[3] = [
          btn.text(`⬅️ Kembali`, `afkmode_election_none`),
          btn.text(`Aktifkan ➡️`, `afkmode_active_none`),
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

      if (type === "rolst") {
        if (!Cache.get(`afkmode${mc[2]}`)) {
          Cache.set(`afkmode${mc[2]}`, true);
        } else {
          Cache.del(`afkmode${mc[2]}`);
        }
        let keyb: any[] = [];
        keyb[0] = [
          btn.text(
            `🕵️‍♂️ Detective ${Cache.get(`afkmodeDet`) ? "(otomatis)" : "(manual)"}`,
            `afkmode_rolst_Det`,
          ),
        ];
        keyb[1] = [
          btn.text(
            `💃 Hooker ${Cache.get(`afkmodeHook`) ? "(otomatis)" : "(manual)"}`,
            `afkmode_rolst_Hook`,
          ),
        ];
        keyb[2] = [btn.text(`❌ Batal`, `cancel_`)];
        keyb[3] = [
          btn.text(`⬅️ Kembali`, `afkmode_election_none`),
          btn.text(`Aktifkan ➡️`, `afkmode_active_none`),
        ];

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
        this.ctx
          .editMessageText(
            `✅ <b>Mode Diatur!</b>\nUserbot akan bertahan hingga hari ke-${Cache.get(`afkmodeDur`)}, Anda akan diberitahu tentang peran semua userbot.`,
            { parse_mode: "HTML" },
          )
          .catch(() => {
            this.ctx.editMessageText(`Something went wrong...`);
          });
      }

      if (type === "disable") {
        Cache.del(`mode`);
        this.ctx
          .editMessageText(
            `✅ <b>Mode Dimatikan!</b>\nUserbot akan afk hingga permainan berakhir.`,
            { parse_mode: "HTML" },
          )
          .catch(() => {
            this.ctx.editMessageText(`Something went wrong...`);
          });
      }
    }
  }
}
