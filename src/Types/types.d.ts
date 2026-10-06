export interface ClientRef {
  workerIndex: number;
  clientIndex: number;
  userId: string;
}

export interface UserInfo {
  id: string;
  firstName: string;
  lastName?: string;
  username?: string;
  fullName: string;
}

export interface ButtonPayload {
  text: string;
  type?: {
    className: string;
    data?: number[];
    url?: string;
  };
}

export interface MessagePayload {
  id: number;
  chatId: string;
  senderId: string;
  text: string;
  out: boolean;
  isPrivate: boolean;
  date: number;
  buttons: ButtonPayload[] | null;
}

export interface SharedState {
  groupTarget: string;
  joinMode: string;
  disabledIds: string[];
  registrationHandled: boolean;
}

export interface GroupInfo {
  id: string;
  title?: string;
  username?: string;
  total?: number;
}

export interface CommandArgs {
  clickButton: { chatId: string; msgId: number; data: number[] };
  sendMessage: { target: string; message: string };
  getGroupInfo: { target: string };
}

export interface CommandResults {
  clickButton: void;
  sendMessage: void;
  getGroupInfo: GroupInfo;
}

export type CommandAction = keyof CommandArgs;

export type WorkerToMain =
  | {
      type: "connected";
      clientIndex: number;
      user: UserInfo;
    }
  | { type: "message"; clientIndex: number; payload: MessagePayload }
  | { type: "editedMessage"; clientIndex: number; payload: MessagePayload }
  | {
      type: "commandResult";
      cmdId: string;
      ok: boolean;
      data?: unknown;
      error?: string;
    }
  | { type: "joinFailed"; clientIndex: number }
  | { type: "log"; text: string };

export type MainToWorker =
  | { type: "init" }
  | { type: "updateState"; state: SharedState }
  | {
      type: "command";
      cmdId: string;
      clientIndex: number;
      action: CommandAction;
      args: CommandArgs[CommandAction];
    };
