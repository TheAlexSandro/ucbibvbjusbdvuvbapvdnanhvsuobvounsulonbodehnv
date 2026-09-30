import type { Bot, Context } from "grammy";
import { Cache } from "../Utils/Caches";
import { InlineKeyboardButton } from "grammy/types";
import { markup } from "./Buttons";

type Callback<T> = (error: string | null, result: T) => void;

export class Utils {
  static getName(ctx: Context): string {
    const name = this.clearHTML(ctx.chat?.first_name!);
    const id = ctx.chat?.id;
    const username = ctx.chat?.username;

    return username
      ? `@${username}`
      : `<a href='tg://user?id=${id}'>${name}</a>`;
  }

  static getNameById(
    userId: string,
    bot: Bot,
    callback: Callback<string | null>,
  ): void {
    bot.api
      .getChat(userId)
      .then((result) => {
        return callback(null, String(result.first_name ?? result.title));
      })
      .catch((err: Error) => {
        return callback(err.message, null);
      });
  }

  static clearHTML(s: string | null): string {
    if (!s) return "null";
    return s.replace(/>/g, "").replace(/</g, "");
  }

  static sendMessageToAdmin(
    bot: Bot,
    message: string,
    keyb?: InlineKeyboardButton[] | InlineKeyboardButton[][] | any[],
  ): void {
    const admins = String(process.env["ADMIN"]).split(",");
    for (var i = 0; i < admins.length; i++) {
      if (keyb) {
        bot.api
          .sendMessage(admins[i], message, {
            parse_mode: "HTML",
            reply_markup: markup.inlineKeyboard(keyb),
          })
          .catch(() => {});
      } else {
        bot.api
          .sendMessage(admins[i], message, { parse_mode: "HTML" })
          .catch(() => {});
      }
    }
  }

  static normalizeChannelId(id: string | number): number {
    let str = id.toString();
    if (str.startsWith("-100")) {
      str = str.slice(4);
    } else if (str.startsWith("-")) {
      str = str.slice(1);
    }
    return Number(str);
  }

  static parsePlayerList(text: string): { number: number; name: string }[] {
    const lines = text.split("\n");
    const players: { number: number; name: string }[] = [];

    for (const line of lines) {
      const match = line.match(/^\s*(\d+)\.\s*(.+)$/);
      if (match) {
        players.push({
          number: Number(match[1]),
          name: match[2].trim(),
        });
      }
    }
    return players;
  }

  static writeLog(log: string) {
    if (!Cache.get(`log`)) {
      Cache.set(`log`, log);
    } else {
      Cache.set(`log`, String(Cache.get(`log`)) + log);
    }
  }
}
