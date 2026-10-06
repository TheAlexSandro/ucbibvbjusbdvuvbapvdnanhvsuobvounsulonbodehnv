import { parentPort, workerData } from "worker_threads";
import { Api, TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import { NewMessage, EditedMessage } from "teleproto/events/index.js";
import type {
  ButtonPayload,
  CommandArgs,
  CommandAction,
  CommandResults,
  MainToWorker,
  MessagePayload,
  SharedState,
  WorkerToMain,
} from "../Types/types";

const { sessionStrings, apiId, apiHash, mafiaBotId, trueMafia } =
  workerData as {
    sessionStrings: string[];
    apiId: number;
    apiHash: string;
    mafiaBotId: string;
    trueMafia: string;
  };

interface Slot {
  client: TelegramClient;
  userId: string;
  mafiaEntity: any | null;
}

const port = parentPort!;
const slots: Slot[] = [];
const peerCache = new Map<string, any>();

let state: SharedState = {
  groupTarget: "",
  joinMode: "",
  disabledIds: [],
  registrationHandled: false,
};
let disabledSet = new Set<string>();

const send = (m: WorkerToMain) => port.postMessage(m);
const log = (text: string) => send({ type: "log", text });

const serializeButtons = (msg: any): ButtonPayload[] | null => {
  if (msg.replyMarkup?.className !== "ReplyInlineMarkup") return null;
  return msg.replyMarkup.rows.flatMap((row: any) =>
    row.buttons.map((b: any): ButtonPayload => ({
      text: b.text,
      type: b.type && {
        className: b.type.className,
        data: b.type.data ? Array.from(b.type.data as Uint8Array) : undefined,
        url: b.type.url,
      },
    })),
  );
};

const serializeMsg = (msg: any): MessagePayload => {
  const chatId = String(msg.chatId);
  if (msg.peerId) {
    if (peerCache.size > 500) peerCache.clear();
    peerCache.set(chatId, msg.peerId);
  }
  return {
    id: msg.id,
    chatId,
    senderId: String(msg.senderId),
    text: msg.text ?? "",
    out: Boolean(msg.out),
    isPrivate: Boolean(msg.isPrivate),
    date: Number(msg.date),
    buttons: serializeButtons(msg),
  };
};

const botUsername = trueMafia.replace(/^@/, "").toLowerCase();
const handledRegistrations = new Set<string>();
const handledAttention = new Set<string>();

const remember = (set: Set<string>, key: string) => {
  set.add(key);
  if (set.size > 100) set.delete(set.values().next().value as string);
};

const findJoinUrl = (msg: any): string | null => {
  if (msg.replyMarkup?.className !== "ReplyInlineMarkup") return null;
  for (const row of msg.replyMarkup.rows) {
    for (const b of row.buttons) {
      const url: string | undefined =
        b.type?.className === "InlineButtonTypeUrl" ? b.type.url : undefined;
      if (!url || !/^https:\/\/t\.me\//i.test(url) || !url.includes("start="))
        continue;
      if (!/^\d+$/.test(botUsername)) {
        const name = new URL(url).pathname.replace(/^\//, "").toLowerCase();
        if (name !== botUsername) continue;
      }
      return url;
    }
  }
  return null;
};

const handleRegistration = (msg: any, t0: number) => {
  if (!["direct", "next"].includes(state.joinMode)) return;
  if (String(msg.chatId) !== state.groupTarget) return;

  const key = `${msg.chatId}:${msg.id}`;
  if (handledRegistrations.has(key)) return;

  const url = findJoinUrl(msg);
  if (!url) return;
  const startParam = new URL(url).searchParams.get("start");
  if (!startParam) return;
  remember(handledRegistrations, key);

  slots.map((slot) => {
    if (!slot || disabledSet.has(slot.userId) || !slot.mafiaEntity) return;
    const tSend = performance.now();

    slot.client
      .sendMessage(slot.mafiaEntity, { message: `/start ${startParam}` })
      .then(() => {
        const done = performance.now();
        log(
          `[lat TS] join OK [${slot.userId}] dispatch=${(tSend - t0).toFixed(1)}ms rtt=${(done - tSend).toFixed(1)}ms total=${(done - t0).toFixed(1)}ms`,
        );
      })
      .catch(() => {});
  });
};

const handleAttentionJoin = (idx: number, msg: any) => {
  const slot = slots[idx];
  if (!slot || !msg.isPrivate || state.joinMode !== "next") return;
  if (disabledSet.has(slot.userId)) return;
  const text: string = msg.text ?? "";
  if (!text.includes("Attention!") && !text.includes("Perhatian!")) return;
  if (msg.replyMarkup?.className !== "ReplyInlineMarkup") return;

  const key = `${idx}:${msg.id}`;
  if (handledAttention.has(key)) return;

  const btn = msg.replyMarkup.rows
    .flatMap((r: any) => r.buttons)
    .find(
      (b: any) =>
        (b.text?.includes("Join") || b.text?.includes("Gabung")) &&
        b.type?.className === "InlineButtonTypeCallback" &&
        b.type?.data,
    );
  if (!btn) return;
  remember(handledAttention, key);

  slot.client
    .invoke(
      new Api.messages.GetBotCallbackAnswer({
        peer: msg.peerId,
        msgId: msg.id,
        data: btn.type.data,
      }),
    )
    .catch(() => send({ type: "joinFailed", clientIndex: idx }));
};

const initClient = async (ss: string, idx: number) => {
  const client = new TelegramClient(new StringSession(ss), apiId, apiHash, {
    connectionRetries: 5,
    autoReconnect: true,
  });

  await client.connect();
  const me: any = await client.getMe();
  await client.invoke(new Api.updates.GetState()).catch(() => {});
  const mafiaEntity = await client.getEntity(trueMafia).catch(() => null);
  slots[idx] = { client, userId: String(me.id), mafiaEntity };
  log(
    `[init] ${me.id} (${me.firstName}) dc=${(client.session as any).dcId} workerClient=${idx}`,
  );

  client.addEventHandler(
    (event: any) => {
      const t0 = performance.now();
      const msg = event.message;
      if (msg.out) return;
      handleRegistration(msg, t0);
      handleAttentionJoin(idx, msg);
      send({ type: "message", clientIndex: idx, payload: serializeMsg(msg) });
    },
    new NewMessage({ fromUsers: [mafiaBotId] }),
  );

  client.addEventHandler(
    (event: any) => {
      const t0 = performance.now();
      const msg = event.message;
      if (msg.out) return;
      handleRegistration(msg, t0);
      send({
        type: "editedMessage",
        clientIndex: idx,
        payload: serializeMsg(msg),
      });
    },
    new EditedMessage({ fromUsers: [mafiaBotId] }),
  );

  const firstName = me.firstName ?? "";
  const lastName = me.lastName ?? undefined;
  send({
    type: "connected",
    clientIndex: idx,
    user: {
      id: String(me.id),
      firstName,
      lastName,
      username: me.username ?? undefined,
      fullName: lastName ? `${firstName} ${lastName}` : firstName,
    },
  });
};

const runCommand = async <A extends CommandAction>(
  slot: Slot,
  action: A,
  args: CommandArgs[A],
): Promise<CommandResults[A]> => {
  switch (action) {
    case "clickButton": {
      const a = args as CommandArgs["clickButton"];
      const peer = peerCache.get(a.chatId);
      if (!peer) throw new Error(`Peer untuk chat ${a.chatId} tidak ditemukan`);
      await slot.client.invoke(
        new Api.messages.GetBotCallbackAnswer({
          peer,
          msgId: a.msgId,
          data: Buffer.from(a.data),
        }),
      );
      return undefined as CommandResults[A];
    }
    case "sendMessage": {
      const a = args as CommandArgs["sendMessage"];
      const entity = await slot.client.getEntity(a.target);
      await slot.client.sendMessage(entity, { message: a.message });
      return undefined as CommandResults[A];
    }
    case "getGroupInfo": {
      const a = args as CommandArgs["getGroupInfo"];
      const entity: any = await slot.client.getEntity(a.target);
      const participants = await slot.client.getParticipants(entity, {
        limit: 0,
      });
      return {
        id: String(entity.id),
        title: entity.title,
        username: entity.username,
        total: participants.total,
      } as CommandResults[A];
    }
    default:
      throw new Error(`Action tidak dikenal: ${String(action)}`);
  }
};

port.on("message", async (msg: MainToWorker) => {
  switch (msg.type) {
    case "init": {
      const results = await Promise.allSettled(
        sessionStrings.map((ss, i) => initClient(ss, i)),
      );
      results.forEach((r, i) => {
        if (r.status === "rejected")
          log(`Gagal init userbot #${i}: ${r.reason?.message ?? r.reason}`);
      });
      return;
    }

    case "updateState": {
      const next = msg.state;
      state = next;
      disabledSet = new Set(next.disabledIds);
      return;
    }

    case "command": {
      const slot = slots[msg.clientIndex];
      try {
        if (!slot) throw new Error("Client belum terhubung");
        const data = await runCommand(slot, msg.action, msg.args as any);
        send({ type: "commandResult", cmdId: msg.cmdId, ok: true, data });
      } catch (err: any) {
        send({
          type: "commandResult",
          cmdId: msg.cmdId,
          ok: false,
          error:
            [err?.errorMessage, err?.message].filter(Boolean).join(" | ") ||
            String(err),
        });
      }
      return;
    }
  }
});

process.on("unhandledRejection", (err: any) =>
  log(`[worker] unhandledRejection: ${err?.message ?? err}`),
);
