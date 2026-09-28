import { Api, TelegramClient } from "teleproto";
import { Cache } from "./Caches";
import { Utils } from "./Utils";
import type { Bot } from "grammy";

export class UserBots {
  private static getTarget(obj: string) {
    const parsed = Object.fromEntries(
      obj.split(",").map((pair: string) => {
        const [key, value] = pair.split(":");
        return [key.trim(), value.trim()];
      }),
    );
    const excluded = [
      "doctor",
      "don",
      "hooker",
      "hobo",
      "maniac",
      "lawyer",
      "kamikaze",
      "mafia",
      "detective",
      "sergeant",
      "journalist",
    ];
    const result = Object.entries(parsed)
      .filter(([, value]) => !excluded.includes(value))
      .map(([key]) => key);

    return result;
  }

  static handleAfkMode(
    client: TelegramClient,
    msg: Api.Message,
    buttons: Api.KeyboardInlineButton[],
    bot: Bot,
  ) {
    if (!Cache.get(`begins`)) return;
    const getRoleList = String(Cache.get(`role`));
    if (
      !getRoleList.includes("doctor") &&
      (!getRoleList.includes("don") || !getRoleList.includes("maniac"))
    ) {
      if (!getRoleList.includes("doctor") && !Cache.get("continu")) {
        if (!Cache.get(`hasSentWarnDoc`)) {
          Cache.set(`hasSentWarnDoc`, true);
          this.clearSmode();
          Utils.sendMessageToAdmin(
            bot,
            `⚠️ <b>Perhatian!</b>\nTidak ada userbot yang memiliki role <b>doctor</b>, smode dibatalkan.`,
          );
        }
      }

      if (!getRoleList.includes("don") && !getRoleList.includes("maniac")) {
        if (!Cache.get(`hasSentWarnKill`)) {
          Cache.set(`hasSentWarnKill`, true);
          Utils.sendMessageToAdmin(
            bot,
            `⚠️ <b>Perhatian!</b>\nTidak ada userbot yang memiliki role pembunuh, smode dijeda hingga salah satu mendapatkan peran <b>don</b>.`,
          );
        }
      }
      return;
    }
    const target = this.getTarget(getRoleList);
    if (!Cache.get(`target`)) {
      Cache.set(`target`, target[0]);
    }

    if (Cache.get(`allroleAfk`)) return;
    if (
      msg.text.includes("Who will you") ||
      msg.text.includes("Whose glass") ||
      msg.text.includes("The Mafia is voting") ||
      msg.text.includes("Time to seek the guilty!") ||
      msg.text.includes("Who are you") ||
      msg.text.includes("Who's today's") ||
      msg.text.includes("Who is getting")
    ) {
      if (msg.text.includes("Who are you gonna") && !Cache.get(`afkmodeHook`))
        return;
      if (
        msg.text.includes("Time to seek the guilty!") &&
        String(Cache.get("useVote")) === "no"
      )
        return;
      if (msg.text.includes("Who will you kill") && !Cache.get(`afkmodeMani`))
        return;
      if (
        msg.text.includes("Who is getting the gifts") &&
        !Cache.get(`afkmodeSanta`)
      )
        return;
      const targetButton = buttons.find((b: any) => {
        return (
          b.text?.includes(target[0]) &&
          b.type?.className === "InlineButtonTypeCallback" &&
          b.type?.data
        );
      });

      if (targetButton) {
        client
          .invoke(
            new Api.messages.GetBotCallbackAnswer({
              peer: msg.peerId,
              msgId: msg.id,
              data: (targetButton as any).type.data,
            }),
          )
          .catch(() => {});
      } else {
        if (msg.text.includes("Who are you gonna") && !Cache.get(`afkmodeHook`))
          return;
        if (
          msg.text.includes("Who is getting the gifts") &&
          !Cache.get(`afkmodeSanta`)
        )
          return;

        const callbackButtons = buttons.filter((b: any) => {
          return (
            !b.text?.includes(String(Cache.get(`doctor`))) &&
            b.type?.className === "InlineButtonTypeCallback" &&
            b.type?.data
          );
        });
        const targetButton =
          callbackButtons[Math.floor(Math.random() * callbackButtons.length)];

        client
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

    if (msg.text.includes("It's time to act") && Cache.get(`afkmodeDet`)) {
      const targetButton = buttons.find((b: any) => {
        return (
          b.text?.includes("Check") &&
          b.type?.className === "InlineButtonTypeCallback" &&
          b.type?.data
        );
      });

      if (targetButton) {
        client
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

  static updateRoleCache(fullName: string, role: string | undefined) {
    let roleUpdateQueue: Promise<void> = Promise.resolve();
    roleUpdateQueue = roleUpdateQueue.then(() => {
      const getRoleList = Cache.get(`role`);

      if (!getRoleList) {
        Cache.set(`role`, `${fullName}:${role}`);
        return;
      }

      const regex = new RegExp(`(^|,)${fullName}:[^,]*`);

      if (regex.test(String(getRoleList))) {
        const updated = String(getRoleList).replace(
          regex,
          `$1${fullName}:${role}`,
        );
        Cache.set(`role`, updated);
      } else {
        Cache.set(`role`, `${getRoleList},${fullName}:${role}`);
      }
    });
    return roleUpdateQueue;
  }

  private static deadUpdateQueue: Promise<void> = Promise.resolve();
  static incrementDead(
    delta: number,
    fullName: string,
    userId: string,
    bot: Bot,
    lynched: boolean,
  ) {
    this.deadUpdateQueue = this.deadUpdateQueue.then(() => {
      const getDead = Cache.get(`dead`);
      const target = Cache.get(`target`);
      const current = getDead ? Number(getDead) : 0;
      Cache.set(`dead`, current + delta);

      if (
        !fullName.includes(String(target)) &&
        !Cache.get(`hasSentKill_${userId}`)
      ) {
        Cache.set(`hasSentKill_${userId}`, true);
        Utils.sendMessageToAdmin(
          bot,
          `☠️ <b>Dead!</b>\nUserbot <a href='tg://user?id=${userId}'>${fullName}</a> ${lynched ? "telah digantung" : "dibunuh dalam permainan"}.`,
        );
      }
    });
    return this.deadUpdateQueue;
  }

  static clearSmode() {
    Cache.del(`afkmodeHook`);
    Cache.del(`afkmodeDet`);
    Cache.del(`afkmodeMani`);
    Cache.del(`afkmodeSanta`);
    Cache.del(`useVote`);
    Cache.del(`mode`);
    Cache.del(`target`);
    Cache.del(`afkmodeDur`);
    Cache.del(`continu`);
    Cache.del(`allroleAfk`);
  }
}
