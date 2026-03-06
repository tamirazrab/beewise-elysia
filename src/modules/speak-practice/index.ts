import { db } from '@common/db';
import {
  speakPracticeSentence,
  userSpeakPracticeCompletion,
  anonymousSpeakPracticeCompletion,
  LEVEL_ORDER,
} from '@common/db/schema';
import { withOptionalAuth } from '@common/middleware/auth-guard';
import { Elysia, t } from 'elysia';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';

/**
 * Speak Practice Module
 *
 * Sentence practice by language and level: CRUD, bulk add, get random sentence.
 */

const levelEnum = t.Union([
  t.Literal('beginner'),
  t.Literal('intermediate'),
  t.Literal('advanced'),
]);

const createSentenceSchema = t.Object({
  sentence: t.String({ minLength: 1, description: 'The sentence to practice' }),
  languageCode: t.String({
    minLength: 2,
    maxLength: 5,
    description: 'ISO 639-1 language code (e.g. en, es, fr)',
  }),
  level: levelEnum,
});

const updateSentenceSchema = t.Object({
  sentence: t.Optional(t.String({ minLength: 1 })),
  languageCode: t.Optional(t.String({ minLength: 2, maxLength: 5 })),
  level: t.Optional(levelEnum),
});

const bulkItemSchema = t.Object({
  sentence: t.String({ minLength: 1 }),
  languageCode: t.String({ minLength: 2, maxLength: 5 }),
  level: levelEnum,
});

export const speakPracticeModule =
  withOptionalAuth(new Elysia({ prefix: '/api/speak-practice' }))

    // GET /api/speak-practice - List sentences
    .get(
      '/',
      async ({ query }: any) => {
        const limit = query.limit ?? 20;
        const offset = query.offset ?? 0;
        const conditions = [isNull(speakPracticeSentence.deletedAt)];
        if (query.languageCode) {
          conditions.push(eq(speakPracticeSentence.languageCode, query.languageCode));
        }
        if (query.level) {
          conditions.push(eq(speakPracticeSentence.level, query.level));
        }
        const items = await db
          .select()
          .from(speakPracticeSentence)
          .where(and(...conditions))
          .orderBy(desc(speakPracticeSentence.createdAt))
          .limit(limit)
          .offset(offset);
        const countResult = await db
          .select({ count: sql<number>`count(*)` })
          .from(speakPracticeSentence)
          .where(and(...conditions));
        return { items, total: Number(countResult[0]?.count ?? 0) };
      },
      {
        query: t.Object({
          languageCode: t.Optional(t.String()),
          level: t.Optional(levelEnum),
          limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
          offset: t.Optional(t.Number({ minimum: 0 })),
        }),
        detail: {
          tags: ['Speak Practice'],
          summary: 'List sentences',
          description: 'Get paginated list of speak-practice sentences with optional filters',
        },
      },
    )

    // GET /api/speak-practice/random - Get single sentence randomly (excludes completed when user/device identified)
    .get(
      '/random',
      async ({ query, set, user, anonymousIdHash }: any) => {
        const conditions = [isNull(speakPracticeSentence.deletedAt)];
        if (query.languageCode) {
          conditions.push(eq(speakPracticeSentence.languageCode, query.languageCode));
        }
        if (query.level) {
          conditions.push(eq(speakPracticeSentence.level, query.level));
        }

        if (user) {
          const [item] = await db
            .select({ data: speakPracticeSentence })
            .from(speakPracticeSentence)
            .leftJoin(
              userSpeakPracticeCompletion,
              and(
                eq(speakPracticeSentence.id, userSpeakPracticeCompletion.sentenceId),
                eq(userSpeakPracticeCompletion.userId, user.id),
              ),
            )
            .where(and(...conditions, isNull(userSpeakPracticeCompletion.sentenceId)))
            .orderBy(sql`random()`)
            .limit(1);
          if (!item?.data) {
            set.status = 404;
            return { error: 'Not Found', message: 'No sentence found matching filters or all have been completed' };
          }
          return { data: item.data };
        }

        if (anonymousIdHash) {
          const [item] = await db
            .select({ data: speakPracticeSentence })
            .from(speakPracticeSentence)
            .leftJoin(
              anonymousSpeakPracticeCompletion,
              and(
                eq(speakPracticeSentence.id, anonymousSpeakPracticeCompletion.sentenceId),
                eq(anonymousSpeakPracticeCompletion.anonymousIdHash, anonymousIdHash),
              ),
            )
            .where(and(...conditions, isNull(anonymousSpeakPracticeCompletion.sentenceId)))
            .orderBy(sql`random()`)
            .limit(1);
          if (!item?.data) {
            set.status = 404;
            return { error: 'Not Found', message: 'No sentence found matching filters or all have been completed' };
          }
          return { data: item.data };
        }

        const [item] = await db
          .select()
          .from(speakPracticeSentence)
          .where(and(...conditions))
          .orderBy(sql`random()`)
          .limit(1);
        if (!item) {
          set.status = 404;
          return { error: 'Not Found', message: 'No sentence found matching filters' };
        }
        return { data: item };
      },
      {
        query: t.Object({
          languageCode: t.Optional(t.String()),
          level: t.Optional(levelEnum),
        }),
        detail: {
          tags: ['Speak Practice'],
          summary: 'Get random sentence',
          description:
            'Get a single sentence at random. When authenticated or X-Device-Id sent, excludes already-completed sentences. Optional filters: language and level (beginner → advanced).',
        },
      },
    )

    // GET /api/speak-practice/next - Next sentence by level progression (beginner → intermediate → advanced), excludes completed
    .get(
      '/next',
      async ({ query, set, user, anonymousIdHash }: any) => {
        if (!user && !anonymousIdHash) {
          set.status = 401;
          return { error: 'Unauthorized', message: 'Send Authorization: Bearer <token> or X-Device-Id to get next sentence by progress' };
        }
        const conditions = [isNull(speakPracticeSentence.deletedAt)];
        if (query.languageCode) {
          conditions.push(eq(speakPracticeSentence.languageCode, query.languageCode));
        }

        for (const level of LEVEL_ORDER) {
          const levelConditions = [...conditions, eq(speakPracticeSentence.level, level)];
          if (user) {
            const [item] = await db
              .select({ data: speakPracticeSentence })
              .from(speakPracticeSentence)
              .leftJoin(
                userSpeakPracticeCompletion,
                and(
                  eq(speakPracticeSentence.id, userSpeakPracticeCompletion.sentenceId),
                  eq(userSpeakPracticeCompletion.userId, user.id),
                ),
              )
              .where(and(...levelConditions, isNull(userSpeakPracticeCompletion.sentenceId)))
              .orderBy(sql`random()`)
              .limit(1);
            if (item?.data) return { data: item.data, level };
          } else {
            const [item] = await db
              .select({ data: speakPracticeSentence })
              .from(speakPracticeSentence)
              .leftJoin(
                anonymousSpeakPracticeCompletion,
                and(
                  eq(speakPracticeSentence.id, anonymousSpeakPracticeCompletion.sentenceId),
                  eq(anonymousSpeakPracticeCompletion.anonymousIdHash, anonymousIdHash!),
                ),
              )
              .where(and(...levelConditions, isNull(anonymousSpeakPracticeCompletion.sentenceId)))
              .orderBy(sql`random()`)
              .limit(1);
            if (item?.data) return { data: item.data, level };
          }
        }
        set.status = 404;
        return { error: 'Not Found', message: 'All speak-practice sentences have been completed for this language' };
      },
      {
        query: t.Object({
          languageCode: t.Optional(t.String()),
        }),
        detail: {
          tags: ['Speak Practice'],
          summary: 'Get next sentence by level',
          description:
            'Returns a random sentence at the next incomplete level (beginner → intermediate → advanced). Excludes completed. Requires auth or X-Device-Id.',
        },
      },
    )

    // POST /api/speak-practice/sentences/:sentenceId/complete - Mark sentence as completed
    .post(
      '/sentences/:sentenceId/complete',
      async ({ params, set, user, anonymousIdHash }: any) => {
        if (!user && !anonymousIdHash) {
          set.status = 401;
          return { error: 'Unauthorized', message: 'Send Authorization: Bearer <token> or X-Device-Id to record completion' };
        }
        const [sentence] = await db
          .select()
          .from(speakPracticeSentence)
          .where(and(eq(speakPracticeSentence.id, params.sentenceId), isNull(speakPracticeSentence.deletedAt)));
        if (!sentence) {
          set.status = 404;
          return { error: 'Not Found', message: 'Sentence not found' };
        }
        if (user) {
          await db
            .insert(userSpeakPracticeCompletion)
            .values({ userId: user.id, sentenceId: params.sentenceId })
            .onConflictDoNothing({ target: [userSpeakPracticeCompletion.userId, userSpeakPracticeCompletion.sentenceId] });
        } else {
          await db
            .insert(anonymousSpeakPracticeCompletion)
            .values({ anonymousIdHash: anonymousIdHash!, sentenceId: params.sentenceId })
            .onConflictDoNothing({
              target: [anonymousSpeakPracticeCompletion.anonymousIdHash, anonymousSpeakPracticeCompletion.sentenceId],
            });
        }
        set.status = 201;
        return { message: 'Sentence marked as completed' };
      },
      {
        params: t.Object({
          sentenceId: t.String({ format: 'uuid' }),
        }),
        detail: {
          tags: ['Speak Practice'],
          summary: 'Mark sentence completed',
          description: 'Record that the user has completed this speak-practice sentence. Requires auth or X-Device-Id.',
        },
      },
    )

    // GET /api/speak-practice/:id - Get single sentence by ID
    .get(
      '/:id',
      async ({ params, set }: any) => {
        const [item] = await db
          .select()
          .from(speakPracticeSentence)
          .where(and(eq(speakPracticeSentence.id, params.id), isNull(speakPracticeSentence.deletedAt)));
        if (!item) {
          set.status = 404;
          return { error: 'Not Found', message: 'Sentence not found' };
        }
        return { data: item };
      },
      {
        params: t.Object({
          id: t.String({ format: 'uuid' }),
        }),
        detail: {
          tags: ['Speak Practice'],
          summary: 'Get sentence',
          description: 'Get a single sentence by ID',
        },
      },
    )

    // POST /api/speak-practice - Create sentence (optional auth)
    .post(
      '/',
      async ({ body, set }: any) => {
        const [item] = await db
          .insert(speakPracticeSentence)
          .values({
            sentence: body.sentence.trim(),
            languageCode: body.languageCode,
            level: body.level,
          })
          .returning();
        set.status = 201;
        return { message: 'Sentence created successfully', data: item };
      },
      {
        body: createSentenceSchema,
        detail: {
          tags: ['Speak Practice'],
          summary: 'Create sentence',
          description: 'Create a new speak-practice sentence. Optional auth.',
        },
      },
    )

    // POST /api/speak-practice/bulk - Bulk add sentences (optional auth)
    .post(
      '/bulk',
      async ({ body, set }: any) => {
        if (!body.items?.length) {
          set.status = 400;
          return { error: 'Bad Request', message: 'items array must have at least one element' };
        }
        const values = body.items.map((it: { sentence: string; languageCode: string; level: string }) => ({
          sentence: it.sentence.trim(),
          languageCode: it.languageCode,
          level: it.level,
        }));
        const inserted = await db.insert(speakPracticeSentence).values(values).returning();
        set.status = 201;
        return { created: inserted.length, data: inserted };
      },
      {
        body: t.Object({
          items: t.Array(bulkItemSchema, { minItems: 1 }),
        }),
        detail: {
          tags: ['Speak Practice'],
          summary: 'Bulk add sentences',
          description: 'Create multiple speak-practice sentences at once. Optional auth.',
        },
      },
    )

    // PUT /api/speak-practice/:id - Update sentence (optional auth)
    .put(
      '/:id',
      async ({ params, body, set }: any) => {
        const [existing] = await db
          .select()
          .from(speakPracticeSentence)
          .where(and(eq(speakPracticeSentence.id, params.id), isNull(speakPracticeSentence.deletedAt)));
        if (!existing) {
          set.status = 404;
          return { error: 'Not Found', message: 'Sentence not found' };
        }
        type Level = 'beginner' | 'intermediate' | 'advanced';
        const updateData: { sentence?: string; languageCode?: string; level?: Level } = {};
        if (body.sentence !== undefined) updateData.sentence = body.sentence.trim();
        if (body.languageCode !== undefined) updateData.languageCode = body.languageCode;
        if (body.level !== undefined) updateData.level = body.level as Level;
        const [item] = await db
          .update(speakPracticeSentence)
          .set(updateData)
          .where(eq(speakPracticeSentence.id, params.id))
          .returning();
        return { message: 'Sentence updated successfully', data: item };
      },
      {
        params: t.Object({
          id: t.String({ format: 'uuid' }),
        }),
        body: updateSentenceSchema,
        detail: {
          tags: ['Speak Practice'],
          summary: 'Update sentence',
          description: 'Update an existing sentence. Optional auth.',
        },
      },
    )

    // DELETE /api/speak-practice/:id - Soft delete (optional auth)
    .delete(
      '/:id',
      async ({ params, set }: any) => {
        const [existing] = await db
          .select()
          .from(speakPracticeSentence)
          .where(and(eq(speakPracticeSentence.id, params.id), isNull(speakPracticeSentence.deletedAt)));
        if (!existing) {
          set.status = 404;
          return { error: 'Not Found', message: 'Sentence not found' };
        }
        await db
          .update(speakPracticeSentence)
          .set({ deletedAt: new Date() })
          .where(eq(speakPracticeSentence.id, params.id));
        return { message: 'Sentence deleted successfully' };
      },
      {
        params: t.Object({
          id: t.String({ format: 'uuid' }),
        }),
        detail: {
          tags: ['Speak Practice'],
          summary: 'Delete sentence',
          description: 'Soft delete a sentence. Optional auth.',
        },
      },
    );
