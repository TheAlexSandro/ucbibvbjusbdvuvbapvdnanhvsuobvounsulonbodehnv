/// <reference types="node" />

import "dotenv/config";
import { definePrismaConfig } from "prisma/config";
import { defineConfig as ormConfig } from "@prisma/orm-postgres/config";

export default definePrismaConfig({
  skills: {
    agents: [],
  },
  orm: ormConfig({
    contract: "./src/prisma/contract.prisma",
    migrations: { dir: "./src/prisma/migrations" },
    db: {
      connection: process.env["DATABASE_URL"],
    },
  }),
});
