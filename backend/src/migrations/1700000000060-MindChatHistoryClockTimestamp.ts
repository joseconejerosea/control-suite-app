import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * mind_chat_history.ts used DEFAULT now(), which returns the TRANSACTION START
 * timestamp — constant for the whole transaction. Because runWithTenant wraps
 * each request in a single transaction (tenant-context.ts), the 'user' and
 * 'assistant' rows inserted during one chat turn received an IDENTICAL ts.
 * `ORDER BY ts DESC` could not disambiguate the tie, so the chat history
 * rendered the reply above the message it answered.
 *
 * clock_timestamp() returns the real wall-clock time at each statement, so the
 * two inserts get distinct timestamps and ordering becomes deterministic.
 * Existing rows keep their (tied) ts; only new turns are affected.
 */
export class MindChatHistoryClockTimestamp1700000000060 implements MigrationInterface {
  name = 'MindChatHistoryClockTimestamp1700000000060';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE mind_chat_history ALTER COLUMN ts SET DEFAULT clock_timestamp()`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE mind_chat_history ALTER COLUMN ts SET DEFAULT now()`);
  }
}
