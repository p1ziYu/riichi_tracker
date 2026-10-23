package com.p1ziyu.riichitracker.p1

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
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
@Serializable private object Create
@Serializable private data class Table(val id: String)

class MainActivity : ComponentActivity() {
    private val model: AppViewModel by viewModels()
    private var incomingLink by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        incomingLink = intent?.dataString?.takeIf { parseCheckInLink(it) != null }
        setContent {
            BrandTheme {
                val state by model.ui.collectAsState()
                when {
                    state.session == SessionMode.RESTORING -> {
                        androidx.compose.foundation.layout.Column {
                            Text(state.authError ?: "正在恢复账户身份…")
                            if (state.authError != null) {
                                androidx.compose.material3.Button(onClick = model::retryRestore) { Text("重试恢复") }
                                androidx.compose.material3.TextButton(onClick = model::abandonRestore) { Text("放弃本机凭据并重新登录") }
                            }
                        }
                    }
                    state.session == SessionMode.LOCAL_ONLY -> {
                        androidx.compose.foundation.layout.Column {
                            Text("本地无身份 · 当前版本尚未提供离线记分；不会创建在线访客身份。")
                            androidx.compose.material3.Button(onClick = model::online) { Text("进入在线登录") }
                        }
                    }
                    state.session == SessionMode.SIGNED_OUT -> {
                        AuthScreen(state.registering, state.authBusy, state.authError,
                            onSubmit = model::login, onModeChange = model::mode,
                            onGuest = model::guest, onLocal = model::localOnly)
                    }
                    incomingLink != null -> {
                        CheckInScreen(incomingLink, state, model) { incomingLink = null }
                        androidx.activity.compose.BackHandler { incomingLink = null }
                    }
                    else -> MainContent(model, state) { incomingLink = "" }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        incomingLink = intent.dataString?.takeIf { parseCheckInLink(it) != null }
    }
}

@Composable
private fun MainContent(model: AppViewModel, state: AppState, onPasteLink: () -> Unit) {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route.orEmpty()
    LaunchedEffect(Unit) { model.loadList() }
    LaunchedEffect(state.createdMatchId) {
        state.createdMatchId?.let { id ->
            model.clearCreatedMatch()
            nav.navigate(Table(id)) { launchSingleTop = true }
        }
    }
    LaunchedEffect(state.joinedMatchId) {
        state.joinedMatchId?.let { id ->
            nav.navigate(Table(id)) { launchSingleTop = true }
            model.clearJoinedMatch()
        }
    }
    Scaffold(bottomBar = {
        if (!route.contains("Table") && !route.contains("Create")) NavigationBar {
            listOf(Triple("大厅", Lobby, route.contains("Lobby")),
                Triple("战绩", History, route.contains("History")),
                Triple("我的", Profile, route.contains("Profile"))).forEach { (title, destination, selected) ->
                NavigationBarItem(selected = selected, onClick = {
                    when (destination) {
                        Lobby -> nav.navigate(Lobby) { popUpTo(nav.graph.findStartDestination().id) { saveState = true }; launchSingleTop = true; restoreState = true }
                        History -> nav.navigate(History) { popUpTo(nav.graph.findStartDestination().id) { saveState = true }; launchSingleTop = true; restoreState = true }
                        Profile -> nav.navigate(Profile) { popUpTo(nav.graph.findStartDestination().id) { saveState = true }; launchSingleTop = true; restoreState = true }
                    }
                }, icon = { Text(title.take(1)) }, label = { Text(title) })
            }
        }
    }) { padding ->
        NavHost(navController = nav, startDestination = Lobby, modifier = Modifier.padding(padding)) {
            composable<Lobby> {
                MatchListScreen(true, state.matches, state.templates, state.listLoading, state.listError,
                    state.listLoading, model::loadList, { nav.navigate(Table(it)) }, { nav.navigate(History) },
                    { nav.navigate(Create) }, onPasteLink, state.session, state.profile?.principal?.displayName)
            }
            composable<History> {
                MatchListScreen(false, state.matches, state.templates, state.listLoading, state.listError,
                    state.listLoading, model::loadList, { nav.navigate(Table(it)) }, { nav.navigate(History) },
                    { nav.navigate(Create) }, onPasteLink, state.session, state.profile?.principal?.displayName)
            }
            composable<Create> {
                CreateScreen(state.templates, state.busy, state.actionError, model::createMatch) { nav.popBackStack() }
            }
            composable<Profile> {
                LaunchedEffect(Unit) { model.loadProfile() }
                ProfileScreen(state.profile, state.profileError, state.diagnostic,
                    model::runDiagnostic, model::logout, onPasteLink, model::loadProfile)
            }
            composable<Table> { stack ->
                val id = stack.toRoute<Table>().id
                val lifecycle = LocalLifecycleOwner.current
                androidx.compose.runtime.DisposableEffect(id) {
                    model.openTable(id)
                    onDispose { model.closeTable() }
                }
                LaunchedEffect(id, state.connectionEpoch) {
                    lifecycle.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                        model.refreshTable(id)
                        model.liveWhileVisible(id)
                    }
                }
                TableScreen(state.table, state.hands, state.settlement, state.templates,
                    state.tableLoading, state.tableError, state.connection, { model.refreshTable(id) }, state, model, id)
            }
        }
    }
}
