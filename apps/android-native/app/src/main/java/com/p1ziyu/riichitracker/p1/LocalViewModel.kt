package com.p1ziyu.riichitracker.p1

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject

/** Does not read tokens, instantiate an API client, or share online match state. */
data class LocalUiState(val matches: List<LocalMatch> = emptyList(), val match: LocalMatch? = null,
    val loading: Boolean = false, val busy: Boolean = false, val error: String? = null,
    val preview: BoundPreview? = null, val terminal: LocalTerminal? = null, val createdId: String? = null)
class LocalViewModel(application: Application) : AndroidViewModel(application) {
    private val store = LocalMatchStore(application)
    private val mutable = kotlinx.coroutines.flow.MutableStateFlow(LocalUiState())
    val ui = mutable.asStateFlow()
    init { reload() }
    fun reload() {
        if (mutable.value.busy) return
        mutable.value = mutable.value.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                val matches = withContext(Dispatchers.IO) { store.list() }
                val selectedId = mutable.value.match?.id
                mutable.value = mutable.value.copy(matches = matches,
                    match = matches.firstOrNull { it.id == selectedId }, loading = false)
            } catch (e: Exception) { mutable.value = mutable.value.copy(loading = false, error = e.message ?: "本地数据库读取失败，原始数据未修改") }
        }
    }
    private fun action(block: suspend () -> LocalMatch?) {
        if (mutable.value.busy) return
        mutable.value = mutable.value.copy(busy = true, error = null)
        viewModelScope.launch {
            try {
                val changed = withContext(Dispatchers.IO) { block() }
                val matches = withContext(Dispatchers.IO) { store.list() }
                mutable.value = mutable.value.copy(busy = false, matches = matches,
                    match = changed ?: mutable.value.match?.let { current -> matches.firstOrNull { it.id == current.id } },
                    preview = null, terminal = null)
            } catch (e: Exception) {
                mutable.value = mutable.value.copy(busy = false, error = e.message ?: "保存失败；原始记录未修改")
            }
        }
    }
    fun create(rules: OnlineRules, name: String, names: List<String>, dealer: Int) {
        val config = try { rules.validated() } catch (e: Exception) { mutable.value = mutable.value.copy(error = e.message); return }
        action {
            val match = store.create(createLocalMatch(config, rules.template.templateKey ?: rules.template.versionId,
                name, names, dealer))
            mutable.value = mutable.value.copy(createdId = match.id)
            match
        }
    }
    fun clearCreated() { mutable.value = mutable.value.copy(createdId = null) }
    fun open(id: String) {
        mutable.value = mutable.value.copy(match = null, preview = null, terminal = null, error = null, loading = true)
        viewModelScope.launch {
            try { mutable.value = mutable.value.copy(match = withContext(Dispatchers.IO) { store.get(id) ?: error("本地牌局不存在或已删除") }, loading = false) }
            catch (e: Exception) { mutable.value = mutable.value.copy(error = e.message, loading = false) }
        }
    }
    fun close() { mutable.value = mutable.value.copy(match = null, preview = null, terminal = null, error = null) }
    private fun change(transform: (LocalMatch) -> LocalMatch) {
        val selected = mutable.value.match ?: return
        action { store.change(selected.id, selected.revision, transform) }
    }
    fun rename(seat: Int, name: String) = change { it.renameSeat(seat, name) }
    fun mark(seat: Int) = change { it.markRiichi(seat) }
    fun saveDraft(draft: ResultDraft) = change { it.copy(draft = draft) }
    fun nextHand() = change { it.openHand() }
    fun settle(input: JsonObject) {
        val preview = mutable.value.preview ?: return
        val match = mutable.value.match ?: return
        val hand = match.currentHand ?: return
        if (preview.handId != hand.handId || preview.revision != hand.markRevision || preview.input != input.toString()) {
            mutable.value = mutable.value.copy(error = "标记或结果已变化，请重新预览")
            return
        }
        change { current ->
            check(current.currentHand?.handId == hand.handId && current.currentHand.markRevision == hand.markRevision) { "当前局已变化" }
            current.settle(input)
        }
    }
    fun preview(input: JsonObject) {
        val match = mutable.value.match ?: return
        val hand = match.currentHand ?: return
        if (mutable.value.busy) return
        try {
            val output = match.previewResult(input)
            mutable.value = mutable.value.copy(preview = BoundPreview(hand.handId, hand.markRevision, input.toString(), output), error = null)
        } catch (e: Exception) { mutable.value = mutable.value.copy(preview = null, error = e.message ?: "无法预览") }
    }
    fun finish() = change { it.finish() }
    fun previewTerminal() {
        try { mutable.value = mutable.value.copy(terminal = mutable.value.match?.previewTerminal(), error = null) }
        catch (e: Exception) { mutable.value = mutable.value.copy(error = e.message ?: "无法预览终局") }
    }
    fun confirmTerminal() = change { it.confirmTerminal() }
    fun delete(id: String) {
        action {
            store.delete(id)
            if (mutable.value.match?.id == id) mutable.value = mutable.value.copy(match = null)
            null
        }
    }
}
