package com.p1ziyu.riichitracker.p1

import android.content.Context
import android.util.AtomicFile
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File

/** Private, non-backed-up transaction journal; never automatically resend an uncertain write. */
@Serializable internal data class PendingRecord(
    val principalId: String, val matchId: String, val handId: String,
    val rawBodyString: String, val clientEventId: String,
) {
    val body: String get() = rawBodyString
}
@Serializable private data class OldPendingRecord(
    val principalId: String, val matchId: String, val handId: String, val body: String,
)

internal class PendingResultStore(context: Context) {
    private val file = AtomicFile(File(context.noBackupFilesDir, "pending-result.json"))
    fun occupied(): Boolean = file.baseFile.exists() ||
        File(file.baseFile.path + ".bak").exists() || File(file.baseFile.path + ".new").exists()
    fun read(principalId: String, matchId: String): PendingResult? = runCatching {
        val bytes = file.readFully().toString(Charsets.UTF_8)
        val record = runCatching { Json.decodeFromString<PendingRecord>(bytes) }.getOrNull()
        if (record != null) {
            record.takeIf { it.principalId == principalId && it.matchId == matchId }
                ?.let { PendingResult(it.matchId, it.handId, it.rawBodyString) }
        } else {
            Json.decodeFromString<OldPendingRecord>(bytes)
                .takeIf { it.principalId == principalId && it.matchId == matchId }
                ?.let { PendingResult(it.matchId, it.handId, it.body) }
        }
    }.getOrNull()
    fun save(principalId: String, pending: PendingResult) {
        check(!occupied()) { "已有待确认请求，请先核对服务端结果，不可覆盖原请求" }
        val eventId = Json.parseToJsonElement(pending.body).jsonObject.getValue("clientEventId").jsonPrimitive.content
        require(eventId.isNotBlank()) { "结算请求缺少 clientEventId" }
        val data = Json.encodeToString(PendingRecord(principalId, pending.matchId, pending.handId, pending.body, eventId))
        val stream = file.startWrite()
        try { stream.write(data.toByteArray(Charsets.UTF_8)); file.finishWrite(stream) }
        catch (e: Exception) { file.failWrite(stream); throw e }
    }
    fun clear() { file.delete() }
}
