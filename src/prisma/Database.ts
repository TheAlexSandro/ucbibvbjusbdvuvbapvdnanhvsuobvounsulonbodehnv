import postgres from "@prisma/orm-postgres/runtime";
import type { Contract } from "./contract.d";
import contractJson from "./contract.json";

export const Database = postgres<Contract>({
  contractJson,
  url: process.env["DATABASE_URL"],
});
export let Db: Awaited<ReturnType<typeof Database.connect>>;
export async function initDb() {
  Db = await Database.connect();
  return Db;
}
