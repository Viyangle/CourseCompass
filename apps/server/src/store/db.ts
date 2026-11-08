/**
 * 极简持久层：一个 JSON 文件 + 原子写 + 防抖落盘。
 *
 * 为什么不用 SQLite：本项目数据量极小（一个学生、几十门课、几个方案），
 * 而且演示时需要能直接打开文件核对。JSON 让"数据可解释"这件事成本最低。
 * 将来要换 SQLite，只需要实现同样的接口（见 docs/01-数据获取与合规.md 的迁移说明）。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Db } from './types.js';
import { buildSeedDb } from './seed.js';

const DB_VERSION = 1;

export class Store {
  private db: Db;
  private saveTimer: NodeJS.Timeout | null = null;
  private writing = Promise.resolve();

  private constructor(
    private readonly file: string,
    db: Db,
  ) {
    this.db = db;
  }

  static async open(dataDir: string): Promise<Store> {
    const file = join(dataDir, 'db.json');
    await mkdir(dataDir, { recursive: true });
    await mkdir(join(dataDir, 'raw'), { recursive: true });

    if (!existsSync(file)) {
      const store = new Store(file, buildSeedDb());
      await store.flush();
      return store;
    }

    const parsed = JSON.parse(await readFile(file, 'utf8')) as Db;
    const db = parsed.version === DB_VERSION ? parsed : { ...buildSeedDb(), ...parsed, version: DB_VERSION };
    return new Store(file, db);
  }

  get data(): Db {
    return this.db;
  }

  /** 用同步结果整体替换本地库（方案由调用方决定是否保留）。 */
  replace(next: Db): void {
    this.db = next;
    void this.flush();
  }

  /** 修改后调用；300ms 防抖，避免拖拽时频繁写盘。 */
  touch(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.flush();
    }, 300);
  }

  /** 立即落盘（原子替换，停电也不会写坏文件）。 */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const snapshot = JSON.stringify(this.db, null, 2);
    const tmp = `${this.file}.tmp`;
    this.writing = this.writing.then(async () => {
      await writeFile(tmp, snapshot, 'utf8');
      await rename(tmp, this.file);
    });
    await this.writing;
  }

  /** 保存原始抓取快照，便于在字段变更后重新映射而不必再登录一次。 */
  async saveRaw(kind: string, payload: unknown, meta: { url?: string } = {}): Promise<string> {
    const id = `raw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const file = join(dirname(this.file), 'raw', `${id}-${kind}.json`);
    await writeFile(file, JSON.stringify({ capturedAt: new Date().toISOString(), meta, payload }, null, 2), 'utf8');
    this.db.rawSnapshots.unshift({
      id,
      kind,
      file,
      capturedAt: new Date().toISOString(),
      url: meta.url,
    });
    this.db.rawSnapshots = this.db.rawSnapshots.slice(0, 50);
    this.touch();
    return file;
  }
}
