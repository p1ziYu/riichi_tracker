package com.p1ziyu.riichitracker.p1

import android.content.Intent
import android.content.ActivityNotFoundException
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
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
@Serializable private data class Table(val id: String)

class MainActivity : ComponentActivity() {
    private val model: AppViewModel by viewModels()
    private var incomingLink by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        incomingLink = intent?.dataString?.takeIf { parseCheckInLink(it) != null }
        setContent {
            MaterialTheme {
                val state by model.ui.collectAsState()
                if (incomingLink != null) {
                    CheckInScreen(incomingLink, this::openExternalBrowser)
                    androidx.activity.compose.BackHandler { incomingLink = null }
                } else if (!state.authenticated) {
                    AuthScreen(state.registering, state.authBusy, state.authError,
                        onSubmit = model::login, onModeChange = model::mode)
                } else {
                    MainContent(model, state) { incomingLink = "" }
                }
            }
        }
    }

    private fun openExternalBrowser(url: String) {
        val generic = Intent(Intent.ACTION_VIEW, Uri.parse("https://example.org/"))
            .addCategory(Intent.CATEGORY_BROWSABLE)
        val browser = packageManager.queryIntentActivities(generic, 0)
            .firstOrNull { it.activityInfo.packageName != packageName }
        if (browser == null) {
            Toast.makeText(this, "未找到可打开网页的浏览器", Toast.LENGTH_SHORT).show()
            return
        }
        val external = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            .addCategory(Intent.CATEGORY_BROWSABLE)
            .setClassName(browser.activityInfo.packageName, browser.activityInfo.name)
        try { startActivity(external) }
        catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "无法打开浏览器", Toast.LENGTH_SHORT).show()
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
    Scaffold(bottomBar = {
        if (!route.contains("Table")) NavigationBar {
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
                    state.listLoading, model::loadList, { nav.navigate(Table(it)) })
            }
            composable<History> {
                MatchListScreen(false, state.matches, state.templates, state.listLoading, state.listError,
                    state.listLoading, model::loadList, { nav.navigate(Table(it)) })
            }
            composable<Profile> {
                LaunchedEffect(Unit) { model.loadProfile() }
                ProfileScreen(state.profile, state.profileError, state.diagnostic,
                    model::runDiagnostic, model::logout, onPasteLink, model::loadProfile)
            }
            composable<Table> { stack ->
                val id = stack.toRoute<Table>().id
                val lifecycle = LocalLifecycleOwner.current
                LaunchedEffect(id) {
                    model.openTable(id)
                    try { lifecycle.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { model.liveWhileVisible(id) } }
                    finally { model.closeTable() }
                }
                TableScreen(state.table, state.hands, state.settlement, state.templates,
                    state.tableLoading, state.tableError, state.connection, { model.refreshTable(id) })
            }
        }
    }
}
