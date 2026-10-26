package com.p1ziyu.riichitracker.p1

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.io.IOException

enum class SessionMode { RESTORING, SIGNED_OUT, ACCOUNT, ONLINE_GUEST, LOCAL_ONLY }

data class AppState(
    val session: SessionMode = SessionMode.SIGNED_OUT, val registering: Boolean = false,
    val authBusy: Boolean = false, val authError: String? = null,
    val profile: MeResponse? = null,
    val matches: List<MatchDetail>? = null, val listLoading: Boolean = false,
    val listError: String? = null,
    val detail: MatchDetail? = null, val detailLoading: Boolean = false,
    val detailError: String? = null,
    val busy: Boolean = false, val actionError: String? = null,
    val createdMatchId: String? = null, val joinedMatchId: String? = null,
    val joinError: String? = null,
    val adminPlayers: List<AdminPlayerDto>? = null, val adminMatches: List<MatchDetail>? = null,
    val adminError: String? = null,
) {
    val isAdmin: Boolean get() = profile?.isAdmin == true
    val meId: String? get() = profile?.principal?.id
}

interface JoinTransport {
    suspend fun get(path: String): String
    suspend fun post(path: String, body: String = "{}"): String
    suspend fun patch(path: String, body: String = "{}"): String
}

class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val store = TokenStore(application)
    private val api = ApiClient(store)
    private val localStore = LocalStore(application)
    private val state = MutableStateFlow(AppState(
        session = if (store.load() != null) SessionMode.RESTORING else SessionMode.SIGNED_OUT,
        authError = if (store.credentialInvalidated) "本机加密凭据不可读取，请重新登录" else null))
    val ui = state.asStateFlow()
    private var generation = 0

    init { if (state.value.session == SessionMode.RESTORING) restore() }

    private fun restore() {
        val at = generation
        viewModelScope.launch {
            try {
                val me = api.json.decodeFromString<MeResponse>(api.get("/api/me"))
                if (at == generation) state.value = state.value.copy(
                    session = if (me.principal.type == "guest") SessionMode.ONLINE_GUEST else SessionMode.ACCOUNT,
                    profile = me, authError = null)
            } catch (e: Exception) {
                if (at == generation) state.value = state.value.copy(
                    session = if (store.load() == null) SessionMode.SIGNED_OUT else SessionMode.RESTORING,
                    authError = if (store.load() == null) "登录已失效，请重新认证" else "恢复会话失败：${e.chineseMessage()}")
            }
        }
    }
    fun retryRestore() { if (store.load() != null) restore() else state.value = AppState(authError = "登录已失效，请重新认证") }
    fun abandonRestore() {
        store.clear(); generation++
        state.value = AppState()
    }
    fun mode(register: Boolean) { state.value = state.value.copy(registering = register, authError = null) }
    fun login(email: String, password: String, name: String?) {
        if (state.value.authBusy) return
        viewModelScope.launch {
            state.value = state.value.copy(authBusy = true, authError = null)
            try {
                api.signIn(email.trim(), password, name?.trim())
                val me = api.json.decodeFromString<MeResponse>(api.get("/api/me"))
                generation++
                state.value = AppState(session = SessionMode.ACCOUNT, profile = me)
            } catch (error: Exception) {
                state.value = state.value.copy(
                    session = if (store.load() != null) SessionMode.RESTORING else SessionMode.SIGNED_OUT,
                    authBusy = false, authError = "登录或注册失败：${error.chineseMessage()}")
            }
        }
    }
    fun guest() {
        if (state.value.authBusy) return
        viewModelScope.launch {
            state.value = state.value.copy(authBusy = true, authError = null)
            try {
                api.anonymous()
                val me = api.json.decodeFromString<MeResponse>(api.get("/api/me"))
                generation++
                state.value = AppState(session = SessionMode.ONLINE_GUEST, profile = me)
            } catch (e: Exception) {
                state.value = state.value.copy(
                    session = if (store.load() != null) SessionMode.RESTORING else SessionMode.SIGNED_OUT,
                    authBusy = false, authError = e.chineseMessage())
            }
        }
    }
    fun localOnly() {
        generation++
        state.value = AppState(session = SessionMode.LOCAL_ONLY)
    }
    fun online() {
        generation++
        state.value = AppState(session = if (store.load() != null) SessionMode.RESTORING else SessionMode.SIGNED_OUT)
        if (state.value.session == SessionMode.RESTORING) restore()
    }
    fun logout() {
        generation++
        state.value = AppState(authBusy = true)
        viewModelScope.launch {
            var remoteFailed = false
            try { api.signOut() } catch (_: Exception) { store.clear(); remoteFailed = true }
            state.value = AppState(authError = if (remoteFailed) "本机已退出；离线退出不保证服务器会话立即撤销" else null)
        }
    }
    fun loadProfile() {
        viewModelScope.launch {
            try { state.value = state.value.copy(profile = api.json.decodeFromString(api.get("/api/me"))) }
            catch (e: Exception) { state.value = state.value.copy(actionError = e.chineseMessage()) }
        }
    }
    fun clearActionError() { state.value = state.value.copy(actionError = null) }

    // ---- Lobby: GET /api/matches/mine (spec §2) ----
    fun loadMine() {
        if (state.value.session != SessionMode.ACCOUNT && state.value.session != SessionMode.ONLINE_GUEST) return
        val at = generation
        viewModelScope.launch {
            state.value = state.value.copy(listLoading = true, listError = null)
            try {
                val matches = api.json.decodeFromString<List<MatchDetail>>(api.get("/api/matches/mine"))
                if (at == generation) state.value = state.value.copy(matches = matches, listLoading = false)
            } catch (e: Exception) {
                if (at == generation) state.value = state.value.copy(listLoading = false, listError = e.chineseMessage())
            }
        }
    }

    private fun operation(id: String?, command: suspend () -> Unit) {
        if (state.value.busy) return
        val at = generation
        viewModelScope.launch {
            state.value = state.value.copy(busy = true, actionError = null)
            try {
                command()
                if (at == generation) { loadMine(); if (id != null) refreshDetail(id) }
            } catch (e: Exception) {
                if (at == generation) state.value = state.value.copy(actionError = e.chineseMessage())
            } finally { if (at == generation) state.value = state.value.copy(busy = false) }
        }
    }

    /** Detail refresh: prefer GET /api/matches/:id when the API serves it,
     *  otherwise fall back to the /api/matches/mine row (see report). */
    fun refreshDetail(id: String) {
        val at = generation
        viewModelScope.launch {
            state.value = state.value.copy(detailLoading = true, detailError = null)
            try {
                val detail = api.json.decodeFromString<MatchDetail>(api.get("/api/matches/$id"))
                if (at == generation) state.value = state.value.copy(detail = detail, detailLoading = false)
            } catch (e: ApiFailure) {
                if (e.status == 404) {
                    val fromMine = state.value.matches?.firstOrNull { it.id == id }
                    if (at == generation) state.value = state.value.copy(
                        detail = fromMine, detailLoading = false,
                        detailError = if (fromMine == null) e.chineseMessage() else null)
                } else if (at == generation) {
                    state.value = state.value.copy(detailLoading = false, detailError = e.chineseMessage())
                }
            } catch (e: Exception) {
                if (at == generation) state.value = state.value.copy(detailLoading = false, detailError = e.chineseMessage())
            }
        }
    }
    fun openDetail(id: String) {
        state.value = state.value.copy(detail = state.value.matches?.firstOrNull { it.id == id },
            detailError = null)
        refreshDetail(id)
    }
    fun clearDetail() { state.value = state.value.copy(detail = null, detailError = null) }

    // ---- Create: POST /api/matches {mode} ----
    fun createMatch(mode: String) = operation(null) {
        if (state.value.session != SessionMode.ACCOUNT) throw IllegalStateException("仅注册用户可创建在线牌桌")
        val created = api.json.decodeFromString<CreatedMatch>(api.post("/api/matches",
            buildJsonObject { put("mode", mode) }.toString()))
        val id = created.matchId ?: throw IOException("服务端未返回牌桌编号")
        state.value = state.value.copy(createdMatchId = id,
            detail = created.match ?: state.value.matches?.firstOrNull { it.id == id })
    }
    fun clearCreatedMatch() { state.value = state.value.copy(createdMatchId = null) }

    // ---- Join: by code, by link, idempotent re-join ----
    private fun joinBody(code: String?, token: String?): String = buildJsonObject {
        if (!code.isNullOrBlank()) put("code", code)
        if (!token.isNullOrBlank()) put("token", token)
    }.toString()

    fun joinByCode(rawCode: String) {
        val code = normalizeJoinCode(rawCode)
        if (code == null) {
            state.value = state.value.copy(joinError = "请输入六位有效房间码（不含 0、1、I、O）。")
            return
        }
        viewModelScope.launch {
            state.value = state.value.copy(busy = true, joinError = null)
            try {
                val byCode = api.json.decodeFromString<ByCodeDto>(api.get("/api/matches/by-code/$code"))
                val joined = api.json.decodeFromString<MatchDetail>(
                    api.post("/api/matches/${byCode.matchId}/join", joinBody(code, byCode.token)))
                state.value = state.value.copy(joinedMatchId = byCode.matchId, busy = false, detail = joined)
                loadMine()
            } catch (e: Exception) {
                state.value = state.value.copy(busy = false, joinError = e.chineseMessage())
            }
        }
    }
    fun joinByLink(link: JoinLink) {
        // Follow-up §3: join requires a credential; a bare link without one
        // must not be posted (server returns 400 missing_credential).
        if (link.token.isNullOrBlank()) {
            state.value = state.value.copy(joinError = "该链接没有加入凭证，请房主重新分享，或使用房间码加入。")
            return
        }
        viewModelScope.launch {
            state.value = state.value.copy(busy = true, joinError = null)
            try {
                // Follow-up §4–§5: token is not consumed (one link seats all);
                // join returns the match view directly.
                val joined = runCatching {
                    api.json.decodeFromString<MatchDetail>(
                        api.post("/api/matches/${link.matchId}/join", joinBody(null, link.token)))
                }.getOrElse { e ->
                    val failure = (e as? ApiFailure)
                    if (failure?.code in setOf("already_member", "already_joined")) null else throw e
                }
                state.value = state.value.copy(joinedMatchId = link.matchId, busy = false,
                    detail = joined ?: state.value.detail)
                loadMine()
            } catch (e: Exception) {
                state.value = state.value.copy(busy = false, joinError = e.chineseMessage())
            }
        }
    }
    fun clearJoinedMatch() { state.value = state.value.copy(joinedMatchId = null) }
    fun clearJoinError() { state.value = state.value.copy(joinError = null) }

    // ---- Final scores: POST (in_progress) / PATCH (finished, host only) ----
    fun submitFinal(id: String, cells: Map<String, String>, correction: Boolean) = operation(id) {
        val detail = state.value.detail?.takeIf { it.id == id } ?: state.value.matches?.firstOrNull { it.id == id }
            ?: throw IllegalStateException("请先刷新牌桌")
        val payload = finalScoresPayload(cells, detail.mode)
            ?: throw IllegalStateException(validateFinalScores(cells, detail.mode).hint)
        val body = buildJsonObject {
            putJsonArray("scores") {
                payload.forEach { add(buildJsonObject { put("wind", it.wind); put("score", it.score) }) }
            }
        }.toString()
        // Follow-up §5: score/correction return the match view directly.
        val updated = api.json.decodeFromString<MatchDetail>(
            if (correction) api.patch("/api/matches/$id/final-scores", body)
            else api.post("/api/matches/$id/final-scores", body))
        state.value = state.value.copy(detail = updated)
    }

    // ---- Cancel: POST /api/matches/:id/cancel (host, confirmed in UI) ----
    fun cancelMatch(id: String) = operation(id) {
        val updated = api.json.decodeFromString<MatchDetail>(api.post("/api/matches/$id/cancel"))
        state.value = state.value.copy(detail = updated)
    }

    // ---- Admin (isAdmin only; server enforces 403) ----
    fun loadAdmin() {
        if (!state.value.isAdmin) return
        val at = generation
        viewModelScope.launch {
            try {
                // Follow-up §5: admin/players returns {players: [...]}, matches return a bare array.
                val players = api.json.decodeFromString<AdminPlayersDto>(api.get("/api/admin/players")).players
                val matches = api.json.decodeFromString<List<MatchDetail>>(api.get("/api/admin/matches"))
                if (at == generation) state.value = state.value.copy(
                    adminPlayers = players, adminMatches = matches, adminError = null)
            } catch (e: Exception) {
                if (at == generation) state.value = state.value.copy(adminError = e.chineseMessage())
            }
        }
    }
    fun deleteAdminMatch(id: String) = operation(null) {
        api.delete("/api/admin/matches/$id")
        loadAdmin()
    }
    fun correctAdminMatch(id: String, cells: Map<String, String>) = operation(id) {
        val detail = state.value.detail?.takeIf { it.id == id }
            ?: state.value.adminMatches?.firstOrNull { it.id == id }
            ?: throw IllegalStateException("请先刷新牌桌")
        val payload = finalScoresPayload(cells, detail.mode)
            ?: throw IllegalStateException(validateFinalScores(cells, detail.mode).hint)
        val body = buildJsonObject {
            putJsonArray("scores") {
                payload.forEach { add(buildJsonObject { put("wind", it.wind); put("score", it.score) }) }
            }
        }.toString()
        // Follow-up §8: admin PATCH requires finished; returns the match view.
        val updated = api.json.decodeFromString<MatchDetail>(
            api.patch("/api/admin/matches/$id/final-scores", body))
        state.value = state.value.copy(detail = updated)
        loadAdmin()
    }

    // ---- Local mode (offline, ViewModel over LocalStore) ----
    val localUi = MutableStateFlow(LocalUiState())
    fun reloadLocal() {
        localUi.value = localUi.value.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                val matches = withContext(Dispatchers.IO) { localStore.list() }
                localUi.value = localUi.value.copy(matches = matches, loading = false)
            } catch (e: Exception) {
                localUi.value = localUi.value.copy(loading = false, error = e.message ?: "本地读取失败")
            }
        }
    }
    fun createLocal(mode: String, names: List<String>) {
        viewModelScope.launch {
            try {
                val match = createLocalFinalMatch(mode, names)
                withContext(Dispatchers.IO) { localStore.save(match) }
                localUi.value = localUi.value.copy(createdId = match.id, error = null)
                reloadLocal()
            } catch (e: Exception) {
                localUi.value = localUi.value.copy(error = e.message ?: "本地建桌失败")
            }
        }
    }
    fun clearLocalCreated() { localUi.value = localUi.value.copy(createdId = null) }
    fun openLocal(id: String) {
        viewModelScope.launch {
            try {
                localUi.value = localUi.value.copy(
                    match = withContext(Dispatchers.IO) { localStore.get(id) ?: error("本地牌局不存在或已删除") },
                    error = null)
            } catch (e: Exception) { localUi.value = localUi.value.copy(error = e.message) }
        }
    }
    fun closeLocal() { localUi.value = localUi.value.copy(match = null) }
    fun saveLocalFinal(cells: Map<String, String>) {
        val current = localUi.value.match ?: return
        viewModelScope.launch {
            try {
                val updated = current.withFinalScores(cells)
                withContext(Dispatchers.IO) { localStore.save(updated) }
                localUi.value = localUi.value.copy(match = updated, error = null)
                reloadLocal()
            } catch (e: Exception) { localUi.value = localUi.value.copy(error = e.message ?: "保存失败") }
        }
    }
    fun cancelLocal() {
        val current = localUi.value.match ?: return
        viewModelScope.launch {
            try {
                val updated = current.cancel()
                withContext(Dispatchers.IO) { localStore.save(updated) }
                localUi.value = localUi.value.copy(match = updated, error = null)
                reloadLocal()
            } catch (e: Exception) { localUi.value = localUi.value.copy(error = e.message ?: "取消失败") }
        }
    }
    fun deleteLocal(id: String) {
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) { localStore.delete(id) }
                if (localUi.value.match?.id == id) localUi.value = localUi.value.copy(match = null)
                reloadLocal()
            } catch (e: Exception) { localUi.value = localUi.value.copy(error = e.message ?: "删除失败") }
        }
    }
    fun clearLocalError() { localUi.value = localUi.value.copy(error = null) }
}

data class LocalUiState(val matches: List<LocalFinalMatch> = emptyList(),
    val match: LocalFinalMatch? = null, val loading: Boolean = false,
    val error: String? = null, val createdId: String? = null)
