package com.p1ziyu.riichitracker.p1

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

class ApiClient(private val store: TokenStore, val client: OkHttpClient = OkHttpClient()) {
    val json = Json { ignoreUnknownKeys = true }
    private val origin = BuildConfig.API_BASE_URL.trimEnd('/')
    val wsOrigin: String get() = if (origin.startsWith("https://"))
        "wss://${origin.removePrefix("https://")}" else "ws://${origin.removePrefix("http://")}"

    suspend fun get(path: String): String = call(path)
    suspend fun post(path: String, body: String = "{}"): String = call(path, body)

    private suspend fun call(path: String, body: String? = null): String = withContext(Dispatchers.IO) {
        val token = store.load()
        val builder = Request.Builder().url("$origin$path")
        if (token != null) builder.header("Authorization", "Bearer $token")
        if (body == null) builder.get()
        else builder.post(body.toRequestBody("application/json".toMediaType()))
        try {
            client.newCall(builder.build()).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    if (response.code == 401 && token != null && store.load() == token) store.clear()
                    val detail = runCatching { json.decodeFromString<ApiErrorDto>(text) }.getOrNull()
                    throw IOException(detail?.message ?: detail?.error ?: text.ifBlank { "请求失败 (${response.code})" })
                }
                if (path == "/api/auth/sign-in/email" || path == "/api/auth/sign-up/email") {
                    val bearer = response.header("set-auth-token")
                        ?: runCatching { json.parseToJsonElement(text).jsonObject["token"]?.jsonPrimitive?.content }.getOrNull()
                    if (bearer.isNullOrBlank()) throw IOException("服务端未返回登录凭据")
                    store.save(bearer)
                }
                text
            }
        } catch (e: IOException) { throw e }
        catch (e: Exception) { throw IOException("网络连接失败", e) }
    }

    suspend fun signIn(email: String, password: String, name: String? = null) {
        val path = if (name == null) "/api/auth/sign-in/email" else "/api/auth/sign-up/email"
        val payload = if (name == null) AuthPayload(email, password) else AuthPayload(email, password, name)
        post(path, json.encodeToString(payload))
    }

    suspend fun signOut() {
        try { post("/api/auth/sign-out") }
        finally { store.clear() }
    }
}

@kotlinx.serialization.Serializable
private data class AuthPayload(val email: String, val password: String, val name: String? = null)
