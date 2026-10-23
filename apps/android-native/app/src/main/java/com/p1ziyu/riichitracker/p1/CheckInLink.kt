package com.p1ziyu.riichitracker.p1

import java.net.URI
import java.net.URLDecoder

/** The secret URL is retained only for the explicit browser handoff, never shown in UI or logs. */
data class CheckInLink(val matchId: String, val hasToken: Boolean, val url: String)

fun parseCheckInLink(input: String): CheckInLink? {
    val url = input.trim()
    val uri = try { URI(url) } catch (_: Exception) { return null }
    if (uri.scheme?.lowercase() != "https" || uri.host?.lowercase() != "riichi.p1ziyu.com" || uri.port != -1 ||
        uri.userInfo != null || uri.fragment != null) return null
    val matchId = Regex("^/checkin/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$")
        .matchEntire(uri.path)?.groupValues?.get(1) ?: return null
    val hasToken = uri.rawQuery?.split('&')?.any {
        val pair = it.split('=', limit = 2)
        pair.size == 2 && pair[0] == "token" &&
            try { URLDecoder.decode(pair[1], "UTF-8").isNotBlank() } catch (_: Exception) { false }
    } == true
    return CheckInLink(matchId, hasToken, url)
}
