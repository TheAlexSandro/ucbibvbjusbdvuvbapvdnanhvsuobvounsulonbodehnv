import { Cache } from "./Caches";
import { Database } from "../prisma/Database";

type Administrators = {
  UserId: string;
  CanAddGroup: boolean;
  CanManageGroup: boolean;
  CanGetRole: boolean;
  CanUseNext: boolean;
  CanStartSmode: boolean;
  CanManageSmode: boolean;
  CanManageUbot: boolean;
  CanUseReset: boolean;
  CanPromoteUser: boolean;
  CanViewLog: boolean;
  CanManageLog: boolean;
  CanLogin: boolean;
  CanManageServer: boolean;
  IsHighAdmin: boolean;
  Promotor: string;
};

export class Admins {
  static getAdmin(
    userId: string,
    callback: (error: string | null, result: Administrators | null) => void,
  ) {
    const getAdmin = Cache.get(`admin_${userId}`);
    if (!getAdmin) {
      Database.orm.public.Administrators.where({ UserId: userId })
        .first()
        .then((r) => {
          if (!r) return callback(null, null);
          Cache.set(`admin_${userId}`, r);
          return callback(null, r);
        })
        .catch((err) => {
          return callback(err instanceof Error ? err.message : err, null);
        });
    } else {
      return callback(null, getAdmin as Administrators);
    }
  }

  static invalidate(userId: string) {
    Cache.del(`admin_${userId}`);
  }
}
