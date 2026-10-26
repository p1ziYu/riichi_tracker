package com.p1ziyu.riichitracker.p1

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Button
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import kotlinx.serialization.Serializable

@Serializable private object Lobby
@Serializable private object History
@Serializable private object Profile
@Serializable private object Local
@Serializable private object Admin
@Serializable private object Scan
@Serializable private data class Share(val id: String)
@Serializable private data class Table(val id: String)
@Serializable private data class Final(val id: String, val correction: Boolean, val admin: Boolean)
@Serializable private data class LocalDetail(val id: String)
@Serializable private data class LocalFinalRoute(val id: String)

class MainActivity : ComponentActivity() {
    private val model: AppViewModel by viewModels()
    private var incomingLink by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        incomingLink = intent?.dataString?.takeIf { parseJoinLink(it) != null }
        setContent {
            BrandTheme {
                val state by model.ui.collectAsState()
                val local by model.localUi.collectAsState()
                LaunchedEffect(state.joinedMatchId) {
                    if (state.joinedMatchId != null) incomingLink = null
                }
                when {
                    state.session == SessionMode.RESTORING -> {
                        androidx.compose.foundation.layout.Column {
                            Text(state.authError ?: "正在恢复账户身份…")
                            if (state.authError != null) {
                                Button(onClick = model::retryRestore) { Text("重试恢复") }
                                OutlinedButton(onClick = model::localOnly) { Text("改用本地无身份模式（保留在线凭据）") }
                                TextButton(onClick = model::abandonRestore) { Text("放弃本机凭据并重新登录") }
                            }
                        }
                    }
                    state.session == SessionMode.LOCAL_ONLY -> {
                        Box(Modifier.fillMaxSize().statusBarsPadding()) {
                            LocalOnlyContent(local, model)
                        }
                    }
                    state.session == SessionMode.SIGNED_OUT -> {
                        AuthScreen(state.registering, state.authBusy, state.authError,
                            onSubmit = model::login, onModeChange = model::mode,
                            onGuest = model::guest, onLocal = model::localOnly)
                    }
                    incomingLink != null -> {
                        val link = parseJoinLink(incomingLink!!)
                        if (link != null) {
                            LaunchedEffect(link.url) { model.joinByLink(link) }
                            androidx.compose.foundation.layout.Column {
                                Text("正在加入牌桌…")
                                state.joinError?.let { Text(it) }
                                TextButton(onClick = { incomingLink = null }) { Text("返回") }
                            }
                        } else incomingLink = null
                    }
                    else -> MainContent(model, state, local)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        incomingLink = intent.dataString?.takeIf { parseJoinLink(it) != null }
    }
}

@Composable private fun LocalOnlyContent(local: LocalUiState, model: AppViewModel) {
    val nav = rememberNavController()
    NavHost(navController = nav, startDestination = Local) {
        composable<Local> {
            LocalScreen(local, model, onOpen = { nav.navigate(LocalDetail(it)) },
                onCreate = {}, onOnline = model::online)
            LaunchedEffect(local.createdId) {
                local.createdId?.let { id -> model.clearLocalCreated(); nav.navigate(LocalDetail(id)) }
            }
        }
        composable<LocalDetail> { stack ->
            val id = stack.toRoute<LocalDetail>().id
            LaunchedEffect(id) { model.openLocal(id) }
            val match = local.match?.takeIf { it.id == id }
            if (match != null) LocalDetailScreen(match, local.error,
                onFinal = { nav.navigate(LocalFinalRoute(id)) },
                onCancel = { model.cancelLocal() }, onBack = { nav.popBackStack() })
            else androidx.compose.foundation.layout.Column {
                Text(local.error ?: "正在读取本地牌桌…")
                TextButton(onClick = { nav.popBackStack() }) { Text("返回") }
            }
        }
        composable<LocalFinalRoute> { stack ->
            val id = stack.toRoute<LocalFinalRoute>().id
            val match = local.match?.takeIf { it.id == id }
            if (match != null) LocalFinalScreen(match, local.error,
                onSave = { cells -> model.saveLocalFinal(cells); nav.popBackStack() },
                onBack = { nav.popBackStack() })
            else androidx.compose.foundation.layout.Column {
                Text(local.error ?: "正在读取本地牌桌…")
                TextButton(onClick = { nav.popBackStack() }) { Text("返回") }
            }
        }
    }
}

@Composable private fun MainContent(model: AppViewModel, state: AppState, local: LocalUiState) {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route.orEmpty()
    LaunchedEffect(Unit) { model.loadMine() }
    LaunchedEffect(state.createdMatchId) {
        state.createdMatchId?.let { id ->
            model.clearCreatedMatch()
            nav.navigate(Share(id)) { launchSingleTop = true }
        }
    }
    LaunchedEffect(state.joinedMatchId) {
        state.joinedMatchId?.let { id ->
            model.clearJoinedMatch()
            model.openDetail(id)
            nav.navigate(Table(id)) { launchSingleTop = true }
        }
    }
    LaunchedEffect(local.createdId) {
        local.createdId?.let { id ->
            model.clearLocalCreated()
            nav.navigate(LocalDetail(id)) { launchSingleTop = true }
        }
    }
    Scaffold(bottomBar = {
        if (!route.contains("Table") && !route.contains("Share") && !route.contains("Final") &&
            !route.contains("Scan") && !route.contains("LocalDetail") && !route.contains("LocalFinal")) {
            NavigationBar {
                listOf(Triple("大厅", Lobby, route.contains("Lobby")),
                    Triple("历史", History, route.contains("History")),
                    Triple("本地", Local, route.contains("Local")),
                    Triple("我的", Profile, route.contains("Profile"))).forEach { (title, destination, selected) ->
                    NavigationBarItem(selected = selected, onClick = {
                        nav.navigate(destination) {
                            popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                            launchSingleTop = true; restoreState = true
                        }
                    }, icon = { Text(title.take(1)) }, label = { Text(title) })
                }
            }
        }
    }) { padding ->
        NavHost(navController = nav, startDestination = Lobby, modifier = Modifier.padding(padding)) {
            composable<Lobby> {
                LobbyScreen(state, model::loadMine, onOpen = { id ->
                    model.openDetail(id)
                    val detail = state.matches?.firstOrNull { it.id == id }
                    if (detail?.status == "waiting") nav.navigate(Share(id))
                    else nav.navigate(Table(id))
                }, onCreate = model::createMatch, onJoinCode = { code ->
                    model.joinByCode(code)
                }, onJoinLink = { raw ->
                    val link = parseJoinLink(raw)
                    if (link == null) {
                        val code = normalizeJoinCode(raw)
                        if (code != null) model.joinByCode(code)
                    } else model.joinByLink(link)
                }, onScan = { nav.navigate(Scan) }, onAdmin = { nav.navigate(Admin) })
            }
            composable<History> {
                HistoryScreen(state, model::loadMine, onOpen = { id ->
                    model.openDetail(id); nav.navigate(Table(id))
                })
            }
            composable<Local> {
                LocalScreen(local, model, onOpen = { nav.navigate(LocalDetail(it)) },
                    onCreate = {}, onOnline = { nav.navigate(Lobby) })
            }
            composable<Profile> {
                LaunchedEffect(Unit) { model.loadProfile() }
                ProfileScreen(state.profile, state.actionError, model::logout, model::localOnly, model::loadProfile)
            }
            composable<Admin> {
                LaunchedEffect(Unit) { model.loadAdmin() }
                AdminScreen(state.adminPlayers, state.adminMatches, state.adminError, state.busy,
                    onRefresh = model::loadAdmin, onOpen = { id ->
                        model.openDetail(id); nav.navigate(Table(id))
                    }, onDelete = model::deleteAdminMatch, onBack = { nav.popBackStack() })
            }
            composable<Scan> {
                ScanScreen(onFound = { raw ->
                    parseJoinLink(raw)?.let { model.joinByLink(it) }
                    nav.popBackStack()
                }, onBack = { nav.popBackStack() })
            }
            composable<Share> { stack ->
                val id = stack.toRoute<Share>().id
                LaunchedEffect(id) { model.openDetail(id) }
                val match = state.detail?.takeIf { it.id == id }
                    ?: state.matches?.firstOrNull { it.id == id }
                if (match != null) ShareScreen(match, onRefresh = { model.refreshDetail(id) },
                    onEnter = { nav.navigate(Table(id)) }, onBack = { nav.popBackStack() })
                else androidx.compose.foundation.layout.Column {
                    Text(state.detailError ?: "正在读取牌桌…")
                    TextButton(onClick = { nav.popBackStack() }) { Text("返回") }
                }
            }
            composable<Table> { stack ->
                val id = stack.toRoute<Table>().id
                LaunchedEffect(id) { model.openDetail(id) }
                val match = state.detail?.takeIf { it.id == id }
                    ?: state.matches?.firstOrNull { it.id == id }
                if (match != null) TableScreen(match, state.meId, state.isAdmin, state.busy,
                    state.actionError, onRefresh = { model.refreshDetail(id) },
                    onFinal = { nav.navigate(Final(id, false, false)) },
                    onCorrect = { nav.navigate(Final(id, true, false)) },
                    onCancel = { model.cancelMatch(id) },
                    onAdminCorrect = { nav.navigate(Final(id, true, true)) },
                    onBack = { nav.popBackStack() })
                else androidx.compose.foundation.layout.Column {
                    Text(state.detailError ?: "正在读取牌桌…")
                    TextButton(onClick = { nav.popBackStack() }) { Text("返回") }
                }
            }
            composable<Final> { stack ->
                val arg = stack.toRoute<Final>()
                LaunchedEffect(arg.id) { model.openDetail(arg.id) }
                val match = state.detail?.takeIf { it.id == arg.id }
                    ?: state.matches?.firstOrNull { it.id == arg.id }
                    ?: state.adminMatches?.firstOrNull { it.id == arg.id }
                if (match != null) FinalScoreScreen(match,
                    initial = match.finalByWind().mapValues { it.value.toString() },
                    busy = state.busy, error = state.actionError, correction = arg.correction,
                    adminMode = arg.admin,
                    onSave = { cells ->
                        if (arg.admin) model.correctAdminMatch(arg.id, cells)
                        else model.submitFinal(arg.id, cells, arg.correction)
                        nav.popBackStack()
                    }, onBack = { nav.popBackStack() })
                else androidx.compose.foundation.layout.Column {
                    Text(state.detailError ?: "正在读取牌桌…")
                    TextButton(onClick = { nav.popBackStack() }) { Text("返回") }
                }
            }
            composable<LocalDetail> { stack ->
                val id = stack.toRoute<LocalDetail>().id
                LaunchedEffect(id) { model.openLocal(id) }
                val match = local.match?.takeIf { it.id == id }
                if (match != null) LocalDetailScreen(match, local.error,
                    onFinal = { nav.navigate(LocalFinalRoute(id)) },
                    onCancel = { model.cancelLocal() }, onBack = { nav.popBackStack() })
                else androidx.compose.foundation.layout.Column {
                    Text(local.error ?: "正在读取本地牌桌…")
                    TextButton(onClick = { nav.popBackStack() }) { Text("返回") }
                }
            }
            composable<LocalFinalRoute> { stack ->
                val id = stack.toRoute<LocalFinalRoute>().id
                val match = local.match?.takeIf { it.id == id }
                if (match != null) LocalFinalScreen(match, local.error,
                    onSave = { cells -> model.saveLocalFinal(cells); nav.popBackStack() },
                    onBack = { nav.popBackStack() })
                else androidx.compose.foundation.layout.Column {
                    Text(local.error ?: "正在读取本地牌桌…")
                    TextButton(onClick = { nav.popBackStack() }) { Text("返回") }
                }
            }
        }
    }
}
