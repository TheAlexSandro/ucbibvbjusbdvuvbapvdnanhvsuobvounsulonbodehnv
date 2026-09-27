import { NewMessageEvent } from "teleproto/events/index.js";
import { Api, TelegramClient } from "teleproto";
import { Cache } from "../Utils/Caches";
import { Utils } from "../Utils/Utils";
import type { Bot } from "grammy";
import { UserBots } from "../Utils/UserBots";
import type { Entity } from "teleproto/define";

export class UserBotHandle {
  event: NewMessageEvent;
  client: TelegramClient;
  bot: Bot;
  clients: TelegramClient[];
  entity: Entity | null;
  constructor(
    evn: NewMessageEvent,
    client: TelegramClient,
    bot: Bot,
    clients: TelegramClient[],
    entity: Entity | null,
  ) {
    this.event = evn;
    this.client = client;
    this.bot = bot;
    this.clients = clients;
    this.entity = entity;
  }

  public handle() {
    const msg = this.event.message;

    if (msg.out) return;
    if (
      msg.isPrivate &&
      Number(msg.senderId) === Number(process.env["MAFIA_BOT_ID"]) &&
      this.entity instanceof Api.User
    ) {
      const isDisabled = Cache.get(
        `userbot_${String(this.entity.id)}_disabled`,
      );
      if (isDisabled) return;

      const fullName = this.entity.lastName
        ? `${this.entity.firstName} ${this.entity.lastName}`
        : this.entity.firstName;

      if (msg.replyMarkup && msg.replyMarkup instanceof Api.ReplyInlineMarkup) {
        const buttons = msg.replyMarkup.rows.flatMap((row) => row.buttons);
        const targetButton = buttons.find((b: any) => {
          return (
            b.text?.includes("Join") &&
            b.type?.className === "InlineButtonTypeCallback" &&
            b.type?.data
          );
        });

        if (
          msg.text?.includes("Attention!") &&
          targetButton &&
          Cache.get(`join`)
        ) {
          msg.getInputChat().then((entity) => {
            this.client
              .invoke(
                new Api.messages.GetBotCallbackAnswer({
                  peer: entity,
                  msgId: msg.id,
                  data: (targetButton as any).type.data,
                }),
              )
              .catch(() => {
                Utils.sendMessageToAdmin(
                  this.bot,
                  `⚠️ <b>Perhatian!</b>\n<a href='tg://user?id=${Number(this.entity?.id)}'>${fullName}</a> gagal bergabung, userbot mungkin dibatasi di grup atau terkena limit.`,
                );
              });
          });
        }

        const getMode = Cache.get("mode");
        if (getMode === "afkmode") {
          UserBots.handleAfkMode(this.client, msg, buttons, this.bot);
        }
      }

      if (msg.text.includes("Couldn't join the game")) {
        Utils.sendMessageToAdmin(
          this.bot,
          `🤚 <a href='tg://user?id=${Number(this.entity.id)}'>${fullName}</a> tidak dapat bergabung tepat waktu.`,
        );
      }

      if (
        msg.text.includes("You're") ||
        msg.text.includes("You are") ||
        msg.text.includes("is a new")
      ) {
        if (msg.text.includes("you're already in the game")) return;

        const match = msg.text.match(
          /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Modifier}\u{200D}\u{FE0F}\u{FE0E}]+\s*([A-Za-z]+)/u,
        );
        const role = match?.[1]?.toLowerCase();

        if (role === "doctor") {
          Cache.set(`doctor`, fullName);
        }
        if (
          msg.text.includes("is a new") &&
          !msg.text.includes(String(fullName))
        )
          return;

        Utils.sendMessageToAdmin(
          this.bot,
          `<a href='tg://user?id=${Number(this.entity.id)}'>${fullName}</a> ${msg.text.includes("is a new") || msg.text.includes("You are the name") ? "is a new" : "-"} ${match?.[0]}`,
        );
        UserBots.updateRoleCache(String(fullName), role);
      }

      if (
        msg.text.includes("You have been killed") ||
        msg.text.includes("Congrats on winning") ||
        msg.text.includes("You stayed idle")
      ) {
        UserBots.incrementDead(
          1,
          String(fullName),
          String(this.entity.id),
          this.bot,
        );
      }

      if (msg.text.includes("doctor patched you up")) {
        UserBots.incrementDead(
          -1,
          String(fullName),
          String(this.entity.id),
          this.bot,
        );
      }
    }

    if (
      String(msg.chatId) === String(Cache.get(`group_target`)) &&
      Number(msg.senderId) === Number(process.env["MAFIA_BOT_ID"])
    ) {
      const match = msg.text.match(/Total:\s*(\d+)/);
      const total = match ? Number(match[1]) : 0;
      if (!Cache.get(`total`)) {
        Cache.set(`total`, total);
      }

      const matchDay = msg.text.match(/Day\s+(\d+)/i);
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

      if (msg.text.includes("The game begins")) {
        if (!Cache.get(`begins`)) {
          Cache.set(`begins`, true);
        }
        if (Cache.get(`join`) && !Cache.get(`continu`)) {
          Cache.del(`join`);
        }
      }

      if (msg.text.includes("The Night Falls")) {
        Cache.set(`roleSepaDon`, true);
        Cache.del(`hasSent`);
        Cache.del(`hasSentWarnKill`);
        const getUbot = String(process.env["USERBOT"]).split(",");
        getUbot.map((id: string) => {
          Cache.del(`hasSentKill_${id}`);
        });
      }

      if (msg.text.includes("#ADVERTISING") || msg.text.includes("Game over")) {
        if (Cache.get(`role`)) {
          Cache.del(`role`);
          if (!Cache.get(`continu`)) {
            UserBots.clearSmode();
          }
          Cache.del(`hasSent`);
          Cache.del(`target`);
          Cache.del(`roleSepaDon`);
          Cache.del(`begins`);
          Cache.del(`hasSentWarnDoc`);
          Cache.del(`hasSentWarnKill`);
          Cache.del(`doctor`);
          Cache.del(`dayNow`);
          const getUbot = String(process.env["USERBOT"]).split(",");
          getUbot.map((id: string) => {
            Cache.del(`hasSentKill_${id}`);
          });
        }
      }

      if (msg.replyMarkup && msg.replyMarkup instanceof Api.ReplyInlineMarkup) {
        const buttons = msg.replyMarkup.rows.flatMap((row) => row.buttons);

        if (msg.text.includes("Registration") && Cache.get(`join`)) {
          this.client.getMe().then((me) => {
            const isDisabled = Cache.get(`userbot_${String(me.id)}_disabled`);
            if (isDisabled) return;
            const targetButton = buttons.find((b: any) => {
              return (
                b.text?.includes("Join") &&
                b.type?.className === "InlineButtonTypeUrl" &&
                b.type?.url
              );
            });

            if (targetButton) {
              const url = (targetButton as any).type.url;
              const parsed = new URL(url);
              const username = parsed.pathname.slice(1);
              const startParam = String(parsed.searchParams.get("start"));
              this.client.getEntity(username).then((entity) => {
                return this.client.invoke(
                  new Api.messages.StartBot({
                    bot: entity,
                    peer: entity,
                    randomId: BigInt(Math.floor(Math.random() * 1e18)) as any,
                    startParam,
                  }),
                );
              });
            }
          });
        }

        if (
          msg.text.includes("Are you sure about lynching") &&
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
            this.client
              .invoke(
                new Api.messages.GetBotCallbackAnswer({
                  peer: msg.peerId,
                  msgId: msg.id,
                  data: (targetButton as any).type.data,
                }),
              )
              .catch(() => {});
          }
        }
      }
    }
    return;
  }

  public editedMessageHandle() {
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
          (msg.text.includes("Who will you") ||
            msg.text.includes("The first subject")) &&
          targetButton
        ) {
          if (msg.text.includes("Who will you") && !Cache.get(`afkmodeDet`))
            return;

          this.client
            .invoke(
              new Api.messages.GetBotCallbackAnswer({
                peer: msg.peerId,
                msgId: msg.id,
                data: (targetButton as any).type.data,
              }),
            )
            .catch(() => {});
        }
      }
    }
  }
}
