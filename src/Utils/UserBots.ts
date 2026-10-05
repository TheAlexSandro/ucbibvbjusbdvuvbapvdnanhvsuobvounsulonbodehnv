import { Api, TelegramClient } from "teleproto";
import { Cache } from "./Caches";
import { Utils } from "./Utils";
import type { Bot } from "grammy";
import { Entity } from "teleproto/define";

export class UserBots {
  private static getTarget(roleList: string, nameList: string): string {
    const parse = (list: string): Record<string, string> =>
      Object.fromEntries(
        list.split(",").map((pair: string) => {
          const [id, value] = pair.split(":");
          return [id.trim(), (value ?? "").trim()];
        }),
      );

    const parsedRoles = parse(roleList);
    const parsedNames = parse(nameList);

    const allowed = [
      // EN
      "townie",
      "suicide",
      "lucky",
      // ID
      "warga",
      "bunuh diri",
      "lucky",
    ];

    const result = Object.entries(parsedRoles)
      .filter(([, value]) => {
        const v = value.toLowerCase();
        return allowed.some((a) => v === a);
      })
      .map(([id]) => parsedNames[id])
      .filter(Boolean);

    let target;
    if (!Cache.get(`target`)) {
      const rand = Math.floor(Math.random() * result.length);
      target = result[rand];
      Cache.set(`target`, target);
    } else {
      target = String(Cache.get(`target`));
    }
    return target;
  }

  static clickButton(
    client: TelegramClient,
    msg: Api.Message,
    btn: any,
    delay = 500,
    retriesLeft = 2,
  ) {
    setTimeout(() => {
      client
        .invoke(
          new Api.messages.GetBotCallbackAnswer({
            peer: msg.peerId,
            msgId: msg.id,
            data: btn.type.data,
          }),
        )
        .catch((err) => {
          Utils.writeLog(
            `[CLICK ERR] ${err instanceof Error ? err.message : String(err)}`,
          );
          const isTimeout =
            err?.errorMessage === "BOT_RESPONSE_TIMEOUT" ||
            err?.message?.includes("BotResponseTimeoutError");

          if (isTimeout && retriesLeft > 0) {
            this.clickButton(client, msg, btn, 500, retriesLeft - 1);
          }
        });
    }, delay);
  }

  static handleAfkMode(
    client: TelegramClient,
    msg: Api.Message,
    buttons: Api.KeyboardInlineButton[],
  ) {
    if (!Cache.get(`begins`)) return;
    if (!Cache.get(`night`)) return;
    const getRoleList = String(Cache.get(`role`));
    const getNameList = String(Cache.get(`roleNames`));

    const hasDoctor =
      getRoleList.includes("doctor") || getRoleList.includes("dokter");
    const hasDon =
      getRoleList.includes("don") || getRoleList.includes("boss lana");
    const hasManiac =
      getRoleList.includes("maniac") || getRoleList.includes("gila");

    if (!hasDoctor && !hasDon && !hasManiac) return;
    const target = this.getTarget(getRoleList, getNameList);
    if (String(Cache.get("mode")) !== "afkmode") return;
    if (Cache.get(`allroleAfk`)) return;

    // --- DETECTIVE ---
    if (
      (msg.text.includes("act!") || msg.text.includes("bertindak!")) &&
      Cache.get(`afkmodeDet`)
    ) {
      const btn = buttons[0];
      if (btn) this.clickButton(client, msg, btn);
    }

    // --- DOCTOR ----
    if (
      msg.text.includes("Who will you heal") ||
      msg.text.includes("Siapa yang akan kamu sembuhkan") ||
      msg.text.includes("Siapa yang akan Anda sembuhkan")
    ) {
      const btn = buttons.find((b: any) => {
        return (
          b.text?.includes(target) &&
          b.type?.className === "InlineButtonTypeCallback" &&
          b.type?.data
        );
      });
      if (btn) this.clickButton(client, msg, btn);
    }

    // --- LAWYER ----
    if (
      msg.text.includes("Who will you protect from justice") ||
      msg.text.includes("Siapa yang akan Anda lindungi dari keadilan")
    ) {
      const btn = buttons.find((b: any) => {
        return (
          b.text?.includes(target) &&
          b.type?.className === "InlineButtonTypeCallback" &&
          b.type?.data
        );
      });
      if (btn) this.clickButton(client, msg, btn);
    }

    // --- HOOKER ---
    if (
      (msg.text.includes("Who are you gonna") ||
        msg.text.includes("Siapa yang akan Anda gedor")) &&
      Cache.get(`afkmodeHook`)
    ) {
      const btnList = buttons.filter((b: any) => {
        return (
          !b.text?.includes(String(Cache.get(`doctor`))) &&
          b.type?.className === "InlineButtonTypeCallback" &&
          b.type?.data
        );
      });
      const btn = btnList[Math.floor(Math.random() * btnList.length)];
      if (btn) this.clickButton(client, msg, btn);
    }

    // --- BODYGUARD ---
    if (
      msg.text.includes("Who are you taking a bullet") ||
      msg.text.includes("Siapa yang akan Anda lindungi")
    ) {
      const btnList = buttons.filter((b: any) => {
        return (
          !b.text?.includes(target) &&
          b.type?.className === "InlineButtonTypeCallback" &&
          b.type?.data
        );
      });
      const btn = btnList[Math.floor(Math.random() * btnList.length)];
      if (btn) this.clickButton(client, msg, btn);
    }

    // --- LYNCH ---
    if (
      (msg.text.includes("Time to seek the guilty") ||
        msg.text.includes("Saatnya mencari yang bersalah")) &&
      String(Cache.get("useVote")) !== "no"
    ) {
      const btn = buttons.find((b: any) => {
        return (
          b.text?.includes(target) &&
          b.type?.className === "InlineButtonTypeCallback" &&
          b.type?.data
        );
      });
      if (btn) {
        this.clickButton(client, msg, btn);
      } else {
        const btn = buttons.find((b: any) => {
          return (
            !b.text?.includes(String(Cache.get(`doctor`))) &&
            b.type?.className === "InlineButtonTypeCallback" &&
            b.type?.data
          );
        });
        if (btn) this.clickButton(client, msg, btn);
      }
    }

    // --- HOBO ---
    if (msg.text.includes("Whose glass") || msg.text.includes("Botol kaca")) {
      const btnList = buttons.filter((b: any) => {
        return b.type?.className === "InlineButtonTypeCallback" && b.type?.data;
      });
      const btn = btnList[Math.floor(Math.random() * btnList.length)];

      if (btn) this.clickButton(client, msg, btn);
    }

    // ---JOURNALIST ---
    if (
      msg.text.includes("Who's today's") ||
      msg.text.includes("Tentang siapa")
    ) {
      const btnList = buttons.filter((b: any) => {
        return b.type?.className === "InlineButtonTypeCallback" && b.type?.data;
      });
      const btn = btnList[Math.floor(Math.random() * btnList.length)];

      if (btn) this.clickButton(client, msg, btn);
    }

    // --- MAFIA ---
    if (
      msg.text.includes("The Mafia is voting") ||
      msg.text.includes("Mafia memilih korban")
    ) {
      const btn = buttons.find((b: any) => {
        return (
          b.text?.includes(target) &&
          b.type?.className === "InlineButtonTypeCallback" &&
          b.type?.data
        );
      });
      if (btn) this.clickButton(client, msg, btn);
    }

    // --- MANIAC ---
    if (
      (msg.text.includes("Who will you kill") ||
        msg.text.includes("Siapa yang akan kamu bunuh") ||
        msg.text.includes("Siapa yang akan Anda bunuh")) &&
      Cache.get(`afkmodeMani`)
    ) {
      const btn = buttons.find((b: any) => {
        return (
          b.text?.includes(target) &&
          b.type?.className === "InlineButtonTypeCallback" &&
          b.type?.data
        );
      });
      if (btn) this.clickButton(client, msg, btn);
    }

    // --- SANTA ---
    if (
      (msg.text.includes("Who is getting the gifts") ||
        msg.text.includes("Siapa yang akan mendapatkan hadiah")) &&
      Cache.get(`afkmodeSanta`)
    ) {
      const btnList = buttons.filter((b: any) => {
        return b.type?.className === "InlineButtonTypeCallback" && b.type?.data;
      });
      const btn = btnList[Math.floor(Math.random() * btnList.length)];

      if (btn) this.clickButton(client, msg, btn);
    }

    // --- DON INVESTIGATE ---
    if (
      (msg.text.includes("Who shall we look") ||
        msg.text.includes("Siapa yang kita selidiki")) &&
      Cache.get(`afkmodeDonCh`)
    ) {
      const btnList = buttons.filter((b: any) => {
        return b.type?.className === "InlineButtonTypeCallback" && b.type?.data;
      });
      const btn = btnList[Math.floor(Math.random() * btnList.length)];

      if (btn) this.clickButton(client, msg, btn);
    }
  }

  static updateRoleCache(
    userId: string,
    fullName: string,
    role: string | undefined,
  ) {
    let roleUpdateQueue: Promise<void> = Promise.resolve();
    roleUpdateQueue = roleUpdateQueue.then(() => {
      const getRoleList = Cache.get(`role`);
      const roleRegex = new RegExp(`(^|,)${userId}:[^,]*`);
      if (!getRoleList) {
        Cache.set(`role`, `${userId}:${role}`);
      } else if (roleRegex.test(String(getRoleList))) {
        Cache.set(
          `role`,
          String(getRoleList).replace(roleRegex, `$1${userId}:${role}`),
        );
      } else {
        Cache.set(`role`, `${getRoleList},${userId}:${role}`);
      }

      const getNameList = Cache.get(`roleNames`);
      const nameRegex = new RegExp(`(^|,)${userId}:[^,]*`);
      if (!getNameList) {
        Cache.set(`roleNames`, `${userId}:${fullName}`);
      } else if (nameRegex.test(String(getNameList))) {
        Cache.set(
          `roleNames`,
          String(getNameList).replace(nameRegex, `$1${userId}:${fullName}`),
        );
      } else {
        Cache.set(`roleNames`, `${getNameList},${userId}:${fullName}`);
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
    Cache.del(`afkmodeDonCh`);
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
    Cache.del(`roleNames`);
    Cache.del(`dead`);
    Cache.del(`hasSent`);
    Cache.del(`hasSentGame`);
    Cache.del(`target`);
    Cache.del(`roleSepaDon`);
    Cache.del(`hasSentWarnDoc`);
    Cache.del(`hasSentWarnKill`);
    Cache.del(`doctor`);
    Cache.del(`dayNow`);
    Cache.del(`night`);
    Cache.del(`registrationHandled`);
    const getUbot = String(process.env["USERBOT"]).split(",");
    getUbot.map((id: string) => {
      Cache.del(`hasSentKill_${id}`);
    });
  }

  static setMafiaEntity(client: TelegramClient, id: string) {
    client.getEntity(String(process.env["TRUE_MAFIA"])).then((entity) => {
      Cache.set(`mafiaEntity_${id}`, entity);
    });
  }

  static getMafiaEntity(
    client: TelegramClient,
    id: string,
    callback: (result: Entity) => void,
  ) {
    const getEnt = Cache.get(`mafiaEntity_${id}`);
    if (!getEnt) {
      client.getEntity(String(process.env["TRUE_MAFIA"])).then((entity) => {
        Cache.set(`mafiaEntity_${id}`, entity);
        return callback(entity);
      });
    } else {
      return callback(getEnt as Entity);
    }
  }
}
