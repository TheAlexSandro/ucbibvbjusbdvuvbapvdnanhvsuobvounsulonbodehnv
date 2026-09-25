import { NewMessageEvent } from "teleproto/events";
import { Api, TelegramClient } from "teleproto";
import { Cache } from "../Utils/Caches";
import { Utils } from "../Utils/Utils";
import type { Bot } from "grammy";
import { UserBots } from "../Utils/UserBots";

export class UserBotHandle {
  event: NewMessageEvent;
  client: TelegramClient;
  bot: Bot;
  clients: TelegramClient[];
  constructor(
    evn: NewMessageEvent,
    client: TelegramClient,
    bot: Bot,
    clients: TelegramClient[],
  ) {
    this.event = evn;
    this.client = client;
    this.bot = bot;
    this.clients = clients;
  }

  public handle() {
    const index = this.clients.indexOf(this.client);
    const isDisabled = Cache.get(`userbot_${index}_disabled`);
    if (isDisabled) return;

    const msg = this.event.message;

    if (msg.out) return;
    if (
      msg.isPrivate &&
      Number(msg.senderId) === Number(process.env["MAFIA_BOT_ID"])
    ) {
      if (msg.replyMarkup && msg.replyMarkup instanceof Api.ReplyInlineMarkup) {
        const buttons = msg.replyMarkup.rows.flatMap((row) => row.buttons);
        const targetButton = buttons.find((b: any) => {
          return (
            b.text?.includes("Join") &&
            b.type?.className === "InlineButtonTypeCallback" &&
            b.type?.data
          );
        });

        if (msg.text?.includes("Attention!") && targetButton) {
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
                this.client.getMe().then((entity) => {
                  const fullName = entity.lastName
                    ? `${entity.firstName} ${entity.lastName}`
                    : entity.firstName;
                  Utils.sendMessageToAdmin(
                    this.bot,
                    `⚠️ <b>Perhatian!</b>\n<a href='tg://user?id=${Number(entity.id)}'>${fullName}</a> gagal bergabung, userbot mungkin dibatasi di grup atau terkena limit.`,
                  );
                });
              });
          });
        }

        const getMode = Cache.get("mode");
        if (getMode === "afkmode") {
          UserBots.handleAfkMode(this.client, msg, buttons, this.bot);
        }
      }

      if (msg.text.includes("Couldn't join the game")) {
        this.client.getMe().then((entity) => {
          const fullName = entity.lastName
            ? `${entity.firstName} ${entity.lastName}`
            : entity.firstName;

          Utils.sendMessageToAdmin(
            this.bot,
            `🤚 <a href='tg://user?id=${Number(entity.id)}'>${fullName}</a> tidak dapat bergabung tepat waktu.`,
          );
        });
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

        this.client.getMe().then((entity) => {
          const fullName = entity.lastName
            ? `${entity.firstName} ${entity.lastName}`
            : entity.firstName;
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
            `<a href='tg://user?id=${Number(entity.id)}'>${fullName}</a> - ${match?.[0]}`,
          );

          UserBots.updateRoleCache(String(fullName), role);
        });
      }

      if (
        msg.text.includes("You have been killed") ||
        msg.text.includes("Congrats on winning")
      ) {
        UserBots.incrementDead(1);
      }

      if (msg.text.includes("doctor patched you up")) {
        UserBots.incrementDead(-1);
      }
    }

    const getGc = String(process.env["MAFIA_GC"]).split(",");
    const isListed = getGc.find((id: string) => id === String(msg.chatId));
    if (!isListed) return;
    if (Number(msg.senderId) === Number(process.env["MAFIA_BOT_ID"])) {
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
          Cache.del(`useVote`);
          Cache.del(`mode`);
          Utils.sendMessageToAdmin(
            this.bot,
            `⚠️ <b>Perhatian!</b>\nSuck mode telah mencapai durasi yang ditentukan - ${dayNumber} hari.`,
          );
        }
      }

      if (msg.text.includes("The game begins")) {
        if (!Cache.get(`begins`)) {
          Cache.set(`begins`, true);
        }
        if (Cache.get(`join`)) {
          Cache.del(`join`);
        }
      }

      if (msg.text.includes("The Night Falls")) {
        Cache.set(`roleSepaDon`, true);
        Cache.del(`hasSent`);
        Cache.del(`hasSentWarnKill`);
      }

      if (msg.text.includes("#ADVERTISING") || msg.text.includes("Game over")) {
        if (Cache.get(`role`)) {
          Cache.del(`role`);
          UserBots.clearSmode();
          Cache.del(`hasSent`);
          Cache.del(`useVote`);
          Cache.del(`target`);
          Cache.del(`roleSepaDon`);
          Cache.del(`begins`);
          Cache.del(`hasSentWarnDoc`);
          Cache.del(`hasSentWarnKill`);
          Cache.del(`doctor`);
          Cache.del(`dayNow`);
        }
      }

      if (msg.replyMarkup && msg.replyMarkup instanceof Api.ReplyInlineMarkup) {
        const buttons = msg.replyMarkup.rows.flatMap((row) => row.buttons);

        if (msg.text.includes("Registration") && Cache.get(`join`)) {
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
          msg.text.includes("Who will you") &&
          Cache.get(`afkmodeDet`) &&
          targetButton
        ) {
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

        if (
          targetButton &&
          (msg.text.includes("story") || msg.text.includes("stories"))
        ) {
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
