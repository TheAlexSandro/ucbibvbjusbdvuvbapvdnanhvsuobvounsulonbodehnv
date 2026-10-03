import { NewMessageEvent } from "teleproto/events/index.js";
import { Api, TelegramClient } from "teleproto";
import { Cache } from "../Utils/Caches";
import { Utils } from "../Utils/Utils";
import type { Bot } from "grammy";
import { UserBots } from "../Utils/UserBots";
import { GameLoopEvents } from "../Utils/GameLoop";

export class UserBotHandle {
  event: NewMessageEvent;
  client: TelegramClient;
  bot: Bot;
  clients: TelegramClient[];
  info: Api.User;
  infos: Api.User[];

  constructor(
    evn: NewMessageEvent,
    client: TelegramClient,
    bot: Bot,
    clients: TelegramClient[],
    info: Api.User,
    infos: Api.User[],
  ) {
    this.event = evn;
    this.client = client;
    this.bot = bot;
    this.clients = clients;
    this.info = info;
    this.infos = infos;
  }

  public handle() {
    const isDisabled = Cache.get(`userbot_${this.info.id}_disabled`);
    if (isDisabled) return;

    const msg = this.event.message;
    const serverTime = msg.date * 1000;
    const receivedTime = Date.now();
    const delay = receivedTime - serverTime;

    if (msg.out) return;
    if (
      msg.isPrivate &&
      Number(msg.senderId) === Number(process.env["MAFIA_BOT_ID"])
    ) {
      const fullName = this.info.lastName
        ? `${this.info.firstName} ${this.info.lastName}`
        : this.info.firstName;

      if (msg.replyMarkup && msg.replyMarkup instanceof Api.ReplyInlineMarkup) {
        const buttons = msg.replyMarkup.rows.flatMap((row) => row.buttons);
        const targetButton = buttons.find((b: any) => {
          return (
            (b.text?.includes("Join") || b.text?.includes("Gabung")) &&
            b.type?.className === "InlineButtonTypeCallback" &&
            b.type?.data
          );
        });

        if (
          (msg.text?.includes("Attention!") ||
            msg.text?.includes("Perhatian!")) &&
          targetButton &&
          String(Cache.get(`join`)) === "next"
        ) {
          this.client
            .invoke(
              new Api.messages.GetBotCallbackAnswer({
                peer: msg.peerId,
                msgId: msg.id,
                data: (targetButton as any).type.data,
              }),
            )
            .catch(() => {
              Utils.sendMessageToAdmin(
                this.bot,
                `⚠️ <b>Perhatian!</b>\n<a href='tg://user?id=${Number(this.info.id)}'>${fullName}</a> gagal bergabung, userbot mungkin dibatasi di grup atau terkena limit.`,
              );
            });
        }

        const getMode = Cache.get("mode");
        if (getMode === "afkmode") {
          UserBots.handleAfkMode(this.client, msg, buttons);
        }
      }

      if (
        msg.text.includes("Couldn't join the game") ||
        msg.text.includes("Tidak dapat bergabung")
      ) {
        Utils.sendMessageToAdmin(
          this.bot,
          `🤚 <a href='tg://user?id=${Number(this.info.id)}'>${fullName}</a> tidak dapat bergabung tepat waktu.`,
        );
      }

      if (
        msg.text.includes("You're") ||
        msg.text.includes("You are") ||
        msg.text.includes("is a new") ||
        msg.text.includes("Anda adalah") ||
        msg.text.includes("Anda sekarang") ||
        msg.text.includes("baru")
      ) {
        if (
          msg.text.includes("you're already in the game") ||
          msg.text.includes("Anda sudah dalam game")
        )
          return;

        const match = msg.text.match(
          /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Modifier}\u{200D}\u{FE0F}\u{FE0E}]+\s*([A-Za-z]+(?:\s[A-Za-z]+)*)/u,
        );
        const role = match?.[1]?.toLowerCase();
        Cache.set(`roleEmot${role}`, match?.[0]);

        if (role === "doctor" || role === "dokter") {
          Cache.set(`doctor`, fullName);
        }
        if (
          (msg.text.includes("is a new") || msg.text.includes("Lana baru")) &&
          !msg.text.includes(String(fullName))
        )
          return;

        Utils.sendMessageToAdmin(
          this.bot,
          `<a href='tg://user?id=${Number(this.info.id)}'>${fullName}</a> ${msg.text.includes("is a new") || msg.text.includes("You are the new") || msg.text.includes("baru") ? "sekarang adalah" : "-"} ${match?.[0]}`,
        );
        UserBots.updateRoleCache(String(fullName), role);
      }

      if (
        msg.text.includes("You have been killed") ||
        msg.text.includes("Congrats on winning") ||
        msg.text.includes("You stayed idle") ||
        msg.text.includes("Anda dibunuh") ||
        msg.text.includes("Selamat, Anda telah") ||
        msg.text.includes("Anda tetap menganggur")
      ) {
        UserBots.incrementDead(
          1,
          String(fullName),
          String(this.info.id),
          this.bot,
          msg.text.includes("You have been killed") ||
            msg.text.includes("Anda dibunuh")
            ? "killed"
            : msg.text.includes("Congrats on winning") ||
                msg.text.includes("Selamat, Anda telah")
              ? "lynch"
              : "idle",
        );
      }

      if (
        msg.text.includes("patched you up") ||
        msg.text.includes("menyembukan Anda")
      ) {
        UserBots.incrementDead(
          -1,
          String(fullName),
          String(this.info.id),
          this.bot,
          null,
        );
      }
    }

    if (
      String(msg.chatId) === String(Cache.get(`groupTarget`)) &&
      Number(msg.senderId) === Number(process.env["MAFIA_BOT_ID"])
    ) {
      if (msg.replyMarkup && msg.replyMarkup instanceof Api.ReplyInlineMarkup) {
        const buttons = msg.replyMarkup.rows.flatMap((row) => row.buttons);

        if (
          (msg.text.includes("Registration") ||
            msg.text.includes("Pendaftaran")) &&
          ["direct", "next"].includes(String(Cache.get(`join`)))
        ) {
          if (Cache.get(`registrationHandled`)) return;
          Cache.set(`registrationHandled`, true);

          const targetButton = buttons.find((b: any) => {
            return (
              (b.text?.includes("Join") || b.text?.includes("Gabung")) &&
              b.type?.className === "InlineButtonTypeUrl" &&
              b.type?.url
            );
          });

          if (targetButton) {
            const url = (targetButton as any).type.url;
            const parsed = new URL(url);
            const startParam = String(parsed.searchParams.get("start"));

            this.clients.forEach((client, i) => {
              UserBots.getMafiaEntity(
                this.client,
                String(this.infos[i].id),
                (entity) => {
                  client
                    .invoke(
                      new Api.messages.StartBot({
                        bot: entity,
                        peer: entity,
                        randomId: BigInt(
                          Math.floor(Math.random() * 1e18),
                        ) as any,
                        startParam,
                      }),
                    )
                    .catch(() => {});
                },
              );
            });
          }
          return;
        }

        if (
          msg.text.includes("Game over") ||
          msg.text.includes("The game is over") ||
          msg.text.includes("Game over") ||
          msg.text.includes("Permainan Berakhir")
        ) {
          if (Cache.get(`userbot_${String(this.info.id)}_disabled`)) return;
          if (!Cache.get(`continu`)) return;
          GameLoopEvents.emit("gameOverDetected", String(this.info.id), () =>
            msg.respond({ message: "/game@TrueMafiaBot" }),
          );
        }

        if (
          msg.text.includes("Registration") ||
          msg.text.includes("Pendaftaran")
        ) {
          if (!Cache.get(`continu`)) return;
          GameLoopEvents.emit("registrationDetected");
        }

        if (
          (msg.text.includes("Are you sure about lynching") ||
            msg.text.includes("Anda yakin ingin menggantung")) &&
          msg.text.includes(String(Cache.get(`target`))) &&
          Cache.get(`useVote`) === "yes"
        ) {
          const targetButton = buttons.find((b: any) => {
            return (
              b.text?.includes("👎") &&
              b.type?.className === "InlineButtonTypeCallback" &&
              b.type?.data
            );
          });
          if (targetButton) {
            UserBots.clickButton(this.client, msg, targetButton);
          }
        }
      }

      const match = msg.text.match(/Total:\s*(\d+)/);
      const total = match ? Number(match[1]) : 0;
      if (!Cache.get(`total`)) {
        Cache.set(`total`, total);
      }

      const matchDay = msg.text.match(/(?:Day|Hari)\s+(\d+)/i);
      const dayNumber = matchDay ? Number(matchDay[1]) : null;
      if (dayNumber !== Number(Cache.get(`dayNow`) ?? 0)) {
        Cache.set(`dayNow`, dayNumber);
      }
      if (dayNumber === Number(Cache.get(`afkmodeDur`))) {
        if (!Cache.get(`hasSent`)) {
          Cache.set(`hasSent`, true);
          if (!Cache.get(`continu`)) {
            UserBots.clearSmode();
          }
          Utils.sendMessageToAdmin(
            this.bot,
            `⚠️ <b>Perhatian!</b>\nSuck mode telah mencapai durasi yang ditentukan - ${dayNumber} hari.${Cache.get(`continu`) ? "\n🔁 Continuous sedang aktif, userbot tidak akan berhenti." : ""}`,
          );
        }
      }

      if (
        msg.text.includes("The game begins") ||
        msg.text.includes("Permainan dimulai")
      ) {
        if (!Cache.get(`begins`)) {
          Cache.set(`begins`, true);
          Cache.del(`registrationHandled`);
          Cache.del(`hasSentGame`);
        }
        if (Cache.get(`join`) && !Cache.get(`continu`)) {
          Cache.del(`join`);
        }
      }

      if (
        msg.text.includes("The Night Falls") ||
        msg.text.includes("Malam yang mengerikan")
      ) {
        if (!Cache.get(`begins`)) {
          Cache.set(`begins`, true);
          Cache.del(`registrationHandled`);
          Cache.del(`hasSentGame`);
        }
        Cache.set(`roleSepaDon`, true);
        Cache.del(`hasSent`);
        Cache.del(`hasSentWarnKill`);
        const getUbot = String(process.env["USERBOT"]).split(",");
        getUbot.map((id: string) => {
          Cache.del(`hasSentKill_${id}`);
        });
      }

      if (
        msg.text.includes("Game canceled") ||
        msg.text.includes("Permainan dibatalkan")
      ) {
        UserBots.clearAll("1");
      }

      if (
        msg.text.includes("#ADVERTISING") ||
        msg.text.includes("Game over") ||
        msg.text.includes("Permainan telah berakhir")
      ) {
        if (Cache.get(`role`)) {
          UserBots.clearAll();
        }
      }
    }
    return;
  }

  public editedMessageHandle() {
    const isDisabled = Cache.get(`userbot_${this.info.id}_disabled`);
    if (isDisabled) return;

    const msg = this.event.message;

    if (msg.out) return;
    if (
      msg.isPrivate &&
      Number(msg.senderId) === Number(process.env["MAFIA_BOT_ID"])
    ) {
      if (msg.replyMarkup && msg.replyMarkup instanceof Api.ReplyInlineMarkup) {
        const buttons = msg.replyMarkup.rows.flatMap((row) => row.buttons);
        const callbackButtons = buttons.filter((b: any) => {
          return (
            !b.text?.includes(String(Cache.get(`doctor`))) &&
            b.type?.className === "InlineButtonTypeCallback" &&
            b.type?.data
          );
        });
        const targetButton =
          callbackButtons[Math.floor(Math.random() * callbackButtons.length)];

        if (
          (msg.text.includes("Who will you check") ||
            msg.text.includes("Siapa yang akan Anda periksa")) &&
          Cache.get(`afkmodeDet`)
        ) {
          UserBots.clickButton(this.client, msg, targetButton);
        }

        if (msg.text.includes("subject") || msg.text.includes("subjek")) {
          UserBots.clickButton(this.client, msg, targetButton);
        }
      }
    }
  }
}
