package com.p1ziyu.riichitracker.p1

import android.content.Context
import android.util.AtomicFile
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import java.io.File

@Serializable data class SavedResultDraft(
    val principalId: String, val matchId: String, val handId: String,
    val revision: Long?, val draft: ResultDraft,
)

internal class ResultDraftStore(context: Context) {
    private val root = context.noBackupFilesDir
    private fun file(principalId: String, matchId: String, handId: String): AtomicFile {
        val key = "$principalId\u0000$matchId\u0000$handId"
        val hash = java.security.MessageDigest.getInstance("SHA-256").digest(key.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        return AtomicFile(File(root, "result-draft-$hash.json"))
    }
    fun read(principalId: String, matchId: String, handId: String): SavedResultDraft? = runCatching {
        Json.decodeFromString<SavedResultDraft>(file(principalId, matchId, handId).readFully().toString(Charsets.UTF_8))
            .takeIf { it.principalId == principalId && it.matchId == matchId && it.handId == handId }
    }.getOrNull()
    fun save(record: SavedResultDraft) {
        val target = file(record.principalId, record.matchId, record.handId)
        val bytes = Json.encodeToString(record).toByteArray(Charsets.UTF_8)
        val stream = target.startWrite()
        try { stream.write(bytes); target.finishWrite(stream) }
        catch (error: Exception) { target.failWrite(stream); throw error }
    }
    fun clear(principalId: String, matchId: String, handId: String) {
        file(principalId, matchId, handId).delete()
    }
    fun clear() {
        root.listFiles()?.filter { it.name.startsWith("result-draft-") }?.forEach { it.delete() }
    }
}
