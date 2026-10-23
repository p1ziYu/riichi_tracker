package com.p1ziyu.riichitracker.p1

import android.content.Context
import android.util.AtomicFile
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

/** Private, non-backed-up transaction journal; never automatically resend an uncertain write. */
@Serializable internal data class PendingRecord(val principalId: String, val matchId: String, val handId: String, val body: String)

internal class PendingResultStore(context: Context) {
    private val file = AtomicFile(File(context.noBackupFilesDir, "pending-result.json"))
    fun read(principalId: String, matchId: String): PendingResult? = runCatching {
        Json.decodeFromString<PendingRecord>(file.readFully().toString(Charsets.UTF_8))
            .takeIf { it.principalId == principalId && it.matchId == matchId }
            ?.let { PendingResult(it.matchId, it.handId, it.body) }
    }.getOrNull()
    fun save(principalId: String, pending: PendingResult) {
        val data = Json.encodeToString(PendingRecord(principalId, pending.matchId, pending.handId, pending.body))
        val stream = file.startWrite()
        try { stream.write(data.toByteArray(Charsets.UTF_8)); file.finishWrite(stream) }
        catch (e: Exception) { file.failWrite(stream); throw e }
    }
    fun clear() { file.delete() }
}
