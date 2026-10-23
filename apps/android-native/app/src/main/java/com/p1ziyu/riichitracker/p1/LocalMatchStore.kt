package com.p1ziyu.riichitracker.p1

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

/** Distinct from account caches, drafts and token storage; no online client is used here. */
class LocalMatchStore(context: Context) {
    companion object {
        const val DB_NAME = "offline_matches.sqlite"
        const val SCHEMA_VERSION = 1
        private data class Migration(val from: Int, val to: Int, val apply: (SQLiteDatabase) -> Unit)
        /** Explicit ordered, non-destructive migrations. Append a migration before increasing SCHEMA_VERSION. */
        private val MIGRATIONS = listOf(Migration(0, 1) { db ->
            db.execSQL("CREATE TABLE schema_marker (id INTEGER PRIMARY KEY CHECK(id = 1), version INTEGER NOT NULL)")
            db.execSQL("INSERT INTO schema_marker (id, version) VALUES (1, 1)")
            db.execSQL("CREATE TABLE matches (id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL)")
            db.execSQL("CREATE TABLE settlement_journal (match_id TEXT NOT NULL, hand_id TEXT NOT NULL, input TEXT NOT NULL, output TEXT NOT NULL, settled_at TEXT NOT NULL, PRIMARY KEY(match_id, hand_id))")
        })
    }
    private val helper = object : SQLiteOpenHelper(context, DB_NAME, null, SCHEMA_VERSION) {
        override fun onCreate(db: SQLiteDatabase) { MIGRATIONS.single { it.from == 0 && it.to == 1 }.apply(db) }
        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
            for (version in oldVersion until newVersion) {
                val migration = MIGRATIONS.singleOrNull { it.from == version && it.to == version + 1 }
                    ?: error("本地数据库缺少 $version → ${version + 1} 迁移，原始数据未修改")
                migration.apply(db)
                db.execSQL("UPDATE schema_marker SET version = ${version + 1} WHERE id = 1")
            }
        }
        override fun onDowngrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int): Unit =
            error("本地数据库版本 $oldVersion 高于本应用支持的 $newVersion；请保留原文件")
    }
    private val json = Json { ignoreUnknownKeys = false }
    private fun database(): SQLiteDatabase {
        val db = helper.writableDatabase
        val marker = db.rawQuery("SELECT version FROM schema_marker WHERE id = 1", null).use {
            check(it.moveToFirst()) { "本地数据库缺少版本标记；原始文件未修改" }
            it.getInt(0)
        }
        check(marker == SCHEMA_VERSION && db.version == SCHEMA_VERSION) { "本地数据库版本不兼容；原始文件未修改" }
        return db
    }
    @Synchronized fun list(): List<LocalMatch> = database().rawQuery(
        "SELECT id, payload, revision FROM matches ORDER BY rowid DESC", null).use { cursor ->
        buildList { while (cursor.moveToNext()) add(decode(cursor.getString(1)).also {
            check(it.id == cursor.getString(0) && it.revision == cursor.getLong(2)) {
                "本地牌局记录标识或版本损坏；请保留原始数据"
            }
        }) }
    }
    @Synchronized fun get(id: String): LocalMatch? = read(database(), id)
    private fun decode(payload: String): LocalMatch = try {
        json.decodeFromString<LocalMatch>(payload).validateStored()
    } catch (cause: Exception) { throw IllegalStateException("本地牌局记录损坏；请保留数据库以便恢复", cause) }
    private fun read(db: SQLiteDatabase, id: String): LocalMatch? =
        db.rawQuery("SELECT payload, revision FROM matches WHERE id = ?", arrayOf(id)).use { cursor ->
            if (cursor.moveToFirst()) decode(cursor.getString(0)).also {
                check(it.id == id && it.revision == cursor.getLong(1)) { "本地牌局记录标识或版本损坏；请保留原始数据" }
            } else null
        }
    @Synchronized fun create(match: LocalMatch): LocalMatch {
        val db = database()
        db.beginTransaction()
        try {
            match.validateStored()
            check(db.insertOrThrow("matches", null, ContentValues().apply {
                put("id", match.id); put("payload", json.encodeToString(match)); put("revision", match.revision)
            }) != -1L)
            db.setTransactionSuccessful()
            return match
        } finally { db.endTransaction() }
    }
    /** Re-read in the transaction. Any stale route or duplicate press cannot settle an old hand twice. */
    @Synchronized fun change(id: String, expectedRevision: Long, transform: (LocalMatch) -> LocalMatch): LocalMatch {
        val db = database()
        db.beginTransaction()
        try {
            val before = read(db, id) ?: error("本地牌局不存在或已删除")
            check(before.revision == expectedRevision) { "牌桌已由另一视图更新，请刷新" }
            check(before.engineVersion == com.riichi.mobileengine.ENGINE_VERSION) {
                "该桌引擎版本不受支持，只能查看已保存的结果"
            }
            val changed = transform(before)
            check(changed.id == id && changed.rules == before.rules &&
                changed.rulesHash == before.rulesHash && changed.startingDealerSeatNo == before.startingDealerSeatNo &&
                changed.seedKey == before.seedKey && changed.results.take(before.results.size) == before.results &&
                changed.results.size >= before.results.size &&
                (!before.settlementConfirmed || changed.terminal == before.terminal && changed.settlementConfirmed)) {
                "已结算的历史和规则不能修改"
            }
            if (before.status == "finished") check(!before.settlementConfirmed &&
                changed.terminal != null &&
                changed == before.copy(terminal = changed.terminal, settlementConfirmed = true)) {
                "已结束牌局仅可确认终局成绩"
            }
            val after = changed.copy(revision = before.revision + 1, updatedAt = java.time.Instant.now().toString()).validateStored()
            if (after.results.size > before.results.size) {
                check(after.results.size == before.results.size + 1) { "每次只能结算一局" }
                val result = after.results.last()
                db.insertOrThrow("settlement_journal", null, ContentValues().apply {
                    put("match_id", id); put("hand_id", result.hand.handId)
                    put("input", result.input.toString()); put("output", json.encodeToString(result.output))
                    put("settled_at", result.settledAt)
                })
            }
            val updates = db.update("matches", ContentValues().apply {
                put("payload", json.encodeToString(after)); put("revision", after.revision)
            }, "id = ? AND revision = ?", arrayOf(id, before.revision.toString()))
            check(updates == 1) { "牌桌在保存时发生变化" }
            db.setTransactionSuccessful()
            return after
        } finally { db.endTransaction() }
    }
    @Synchronized fun delete(id: String) {
        val db = database()
        db.beginTransaction()
        try {
            db.delete("settlement_journal", "match_id = ?", arrayOf(id))
            check(db.delete("matches", "id = ?", arrayOf(id)) == 1) { "本地牌局不存在或已删除" }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
}
