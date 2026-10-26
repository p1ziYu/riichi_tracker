package com.p1ziyu.riichitracker.p1

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/** Local-only store. Separate file from any online cache; never uploaded. */
class LocalStore(context: Context) {
    private val json = Json { ignoreUnknownKeys = false }
    private val helper = object : SQLiteOpenHelper(context, "final_local_matches.sqlite", null, 1) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL("CREATE TABLE matches (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
        }
        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
            error("本地数据库版本 $oldVersion 高于本应用支持的 $newVersion；请保留原文件")
        }
        override fun onDowngrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
            error("本地数据库版本 $oldVersion 高于本应用支持的 $newVersion；请保留原文件")
        }
    }
    @Synchronized fun list(): List<LocalFinalMatch> =
        helper.readableDatabase.rawQuery(
            "SELECT payload FROM matches ORDER BY rowid DESC", null).use { cursor ->
            buildList { while (cursor.moveToNext()) add(json.decodeFromString(cursor.getString(0))) }
        }
    @Synchronized fun get(id: String): LocalFinalMatch? =
        helper.readableDatabase.rawQuery(
            "SELECT payload FROM matches WHERE id = ?", arrayOf(id)).use { cursor ->
            if (cursor.moveToFirst()) json.decodeFromString(cursor.getString(0)) else null
        }
    @Synchronized fun save(match: LocalFinalMatch) {
        val db = helper.writableDatabase
        db.insertWithOnConflict("matches", null, ContentValues().apply {
            put("id", match.id); put("payload", json.encodeToString(match))
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }
    @Synchronized fun delete(id: String) {
        check(helper.writableDatabase.delete("matches", "id = ?", arrayOf(id)) == 1) {
            "本地牌局不存在或已删除"
        }
    }
}
