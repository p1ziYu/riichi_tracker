package com.p1ziyu.riichitracker.p1

import java.net.URI
import java.net.URLDecoder

/** Secret stays in ephemeral UI state; never put this object on a persisted navigation route. */
data class CheckInLink(val matchId: String, val token: String?, val url: String) {
    val hasToken: Boolean get() = !token.isNullOrBlank()
}

fun parseCheckInLink(input: String): CheckInLink? {
    val url = input.trim()
    val uri = try { URI(url) } catch (_: Exception) { return null }
    if (uri.scheme?.lowercase() != "https" || uri.host?.lowercase() != "riichi.p1ziyu.com" || uri.port != -1 ||
        uri.userInfo != null || uri.fragment != null) return null
    val matchId = Regex("^/checkin/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$")
        .matchEntire(uri.rawPath)?.groupValues?.get(1) ?: return null
    val params = uri.rawQuery?.split('&')?.map { it.split('=', limit = 2) }.orEmpty()
    if (params.any { it.size != 2 || it[0] != "token" } || params.count { it[0] == "token" } > 1) return null
    val token = try { params.singleOrNull()?.get(1)?.let { URLDecoder.decode(it, "UTF-8") } }
        catch (_: Exception) { return null }
    return CheckInLink(matchId, token?.takeIf { it.isNotBlank() }, url)
}
