#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/2a5f3b3f81fa36854422aa20fcfb20216ec79bf57ff8fbe2b6638a3b08ed60e0/contract';
import endContract from '../../snapshots/2a5f3b3f81fa36854422aa20fcfb20216ec79bf57ff8fbe2b6638a3b08ed60e0/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createTable({
        schema: 'public',
        table: 'DisabledUserBot',
        columns: [col('UserId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } })],
        constraints: [primaryKey(['UserId'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'Group',
        columns: [col('GroupId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } })],
        constraints: [primaryKey(['GroupId'])],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
