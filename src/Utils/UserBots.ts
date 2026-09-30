import { Api, TelegramClient } from "teleproto";
import { Cache } from "./Caches";
import { Utils } from "./Utils";
import type { Bot } from "grammy";
import { Entity } from "teleproto/define";

type Callback<T> = (error: string | null, result: T) => void;

export class UserBots {
  private static getTarget(obj: string) {
    const parsed = Object.fromEntries(
      obj.split(",").map((pair: string) => {
        const [key, value] = pair.split(":");
        return [key.trim(), value.trim()];
      }),
    );
    const excluded = [
      //EN
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
      //ID
      "dokter",
      "boss lana",
      "pelacur",
      "gelandangan",
      "gila",
      "pengacara",
      "kamikaze",
      "mafia",
      "detektif",
      "sersan",
      "wartawan",
    ];
    const result = Object.entries(parsed)
      .filter(([, value]) => !excluded.includes(value.toLocaleLowerCase()))
      .map(([key]) => key);

    return result;
  }

  static handleAfkMode(
    client: TelegramClient,
    msg: Api.Message,
    buttons: Api.KeyboardInlineButton[],
  ) {
    if (!Cache.get(`begins`)) return;
    const getRoleList = String(Cache.get(`role`));
    if (
      !(getRoleList.includes("doctor") || getRoleList.includes("dokter")) &&
      (!getRoleList.includes("don") ||
        !getRoleList.includes("maniac") ||
        !getRoleList.includes("boss lana") ||
        !getRoleList.includes("gila"))
    )
      return;
    const target = this.getTarget(getRoleList);
    if (!Cache.get(`target`)) {
      Cache.set(`target`, target[0]);
    }

    if (Cache.get(`allroleAfk`)) return;
    if (
      msg.text.includes("Who will you") ||
      msg.text.includes("Whose glass") ||
      msg.text.includes("The Mafia is voting") ||
      msg.text.includes("Time to seek the guilty") ||
      msg.text.includes("Who are you") ||
      msg.text.includes("Who's today's") ||
      msg.text.includes("Who is getting") ||
      msg.text.includes("Siapa yang") ||
      msg.text.includes("Botol kaca") ||
      msg.text.includes("Mafia memilih korban") ||
      msg.text.includes("Saatnya mencari yang bersalah") ||
      msg.text.includes("Tentang siapa")
    ) {
      if (
        (msg.text.includes("Who are you gonna") ||
          msg.text.includes("Siapa yang akan Anda gedor")) &&
        !Cache.get(`afkmodeHook`)
      )
        return;
      if (
        (msg.text.includes("Time to seek the guilty") ||
          msg.text.includes("Saatnya mencari yang bersalah")) &&
        String(Cache.get("useVote")) === "no"
      )
        return;
      if (
        (msg.text.includes("Who will you kill") ||
          msg.text.includes("Siapa yang akan Anda bunuh")) &&
        !Cache.get(`afkmodeMani`)
      )
        return;
      if (
        (msg.text.includes("Who is getting the gifts") ||
          msg.text.includes("Siapa yang akan mendapatkan hadiah")) &&
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
        setTimeout(() => {
          client
            .invoke(
              new Api.messages.GetBotCallbackAnswer({
                peer: msg.peerId,
                msgId: msg.id,
                data: (targetButton as any).type.data,
              }),
            )
            .catch(() => {});
        }, 700);
      } else {
        if (
          (msg.text.includes("Who are you gonna") ||
            msg.text.includes("Siapa yang akan Anda gedor")) &&
          !Cache.get(`afkmodeHook`)
        )
          return;
        if (
          (msg.text.includes("Who is getting the gifts") ||
            msg.text.includes("Siapa yang akan mendapatkan hadiah")) &&
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

        setTimeout(() => {
          client
            .invoke(
              new Api.messages.GetBotCallbackAnswer({
                peer: msg.peerId,
                msgId: msg.id,
                data: (targetButton as any).type.data,
              }),
            )
            .catch(() => {});
        }, 700);
      }
    }

    if (
      (msg.text.includes("It's time to act") ||
        msg.text.includes("Saatnya bertindak")) &&
      Cache.get(`afkmodeDet`)
    ) {
      const targetButton = buttons.find((b: any) => {
        return (
          (b.text?.includes("Check") || b.text?.includes("Memeriksa")) &&
          b.type?.className === "InlineButtonTypeCallback" &&
          b.type?.data
        );
      });

      if (targetButton) {
        setTimeout(() => {
          client
            .invoke(
              new Api.messages.GetBotCallbackAnswer({
                peer: msg.peerId,
                msgId: msg.id,
                data: (targetButton as any).type.data,
              }),
            )
            .catch(() => {});
        }, 700);
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
    type: "killed" | "lynch" | "idle" | null,
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
        const msg = {
          killed: "telah dibunuh dalam permainan.",
          lynch: "telah digantung.",
          idle: "dibunuh karena afk.",
        };
        Utils.sendMessageToAdmin(
          bot,
          `☠️ <b>Dead!</b>\nUserbot <a href='tg://user?id=${userId}'>${fullName}</a> ${msg[type!]}`,
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
    Cache.del(`join`);
  }

  static clearAll(type?: string) {
    Cache.del(`role`);
    Cache.del(`begins`);
    if (!Cache.get(`continu`)) {
      this.clearSmode();
    } else {
      if (!Cache.get(`join`) && type === "1") {
        Cache.set(`join`, "direct");
      }
    }
    Cache.del(`dead`);
    Cache.del(`hasSent`);
    Cache.del(`hasSentGame`);
    Cache.del(`target`);
    Cache.del(`roleSepaDon`);
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
