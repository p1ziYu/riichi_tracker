package com.p1ziyu.riichitracker.p1

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import com.riichi.mobileengine.ENGINE_VERSION
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
@RunWith(RobolectricTestRunner::class)
class LocalMatchTest {
    private lateinit var context: Context
    private val template = localTemplateDto(LOCAL_TEMPLATES.first { it.key == "house_4p" })
    private fun rules() = OnlineRules(template).validated()
    private fun newMatch() = createLocalMatch(rules(), "house_4p", "周五牌桌", listOf("东", "南", "西", "北"), 0,
        "2026-01-01T00:00:00Z", "local-test")
    private fun ron(winner: Int, discarder: Int) = buildJsonObject {
        put("kind", "ron"); put("winners", buildJsonArray { add(buildJsonObject {
            put("seatNo", winner); put("han", 2); put("fu", 30); put("dealInSeatNo", discarder)
        }) })
    }
    private fun tsumo(winner: Int) = buildJsonObject {
        put("kind", "tsumo"); put("winners", buildJsonArray { add(buildJsonObject {
            put("seatNo", winner); put("han", 2); put("fu", 30)
        }) })
    }
    private fun draw(tenpaiSeat: Int, count: Int = 4) = buildJsonObject {
        put("kind", "ryuukyoku"); put("winners", buildJsonArray { }); put("tenpai", buildJsonArray {
            repeat(count) { add(it == tenpaiSeat) }
        })
    }
    @Before fun clear() {
        context = org.robolectric.RuntimeEnvironment.getApplication()
        context.deleteDatabase(LocalMatchStore.DB_NAME)
    }
    @Test fun fourTemplatesOpenImmediatelyAndRoundTripTheirFrozenRules() {
        for (seed in LOCAL_TEMPLATES) {
            val rule = OnlineRules(localTemplateDto(seed))
            val match = createLocalMatch(rule.validated(), seed.key, seed.title,
                List(rule.playerCount) { "" }, rule.playerCount - 1)
            assertEquals(rule.playerCount - 1, match.currentHand?.dealerSeatNo)
            assertEquals(rule.playerCount - 1, match.startingDealerSeatNo)
            assertEquals(localRulesHash(match.rules), match.rulesHash)
            assertEquals(64, match.rulesHash.length)
            assertEquals(List(rule.playerCount) { rule.validated().getValue("startingPoints").jsonPrimitive.int }, match.points)
            assertEquals(ENGINE_VERSION, match.engineVersion)
            assertEquals(match, Json.decodeFromString<LocalMatch>(Json.encodeToString(match)))
        }
    }
    @Test fun seatNamesRespectFortyCharactersAndLowPointMarksFollowFrozenRules() {
        val standard = newMatch()
        val forty = "甲".repeat(40)
        val renamed = standard.renameSeat(0, forty)
        assertEquals(forty, renamed.seats[0])
        assertThrows(IllegalStateException::class.java) { renamed.renameSeat(0, forty + "甲") }
        assertThrows(IllegalArgumentException::class.java) {
            createLocalMatch(rules(), "house_4p", "牌桌", listOf(forty + "甲", "南", "西", "北"), 0)
        }
        val poor = standard.copy(points = listOf(900, 25000, 25000, 25000),
            currentHand = standard.currentHand!!.copy(seats = standard.currentHand.seats.map {
                if (it.seatNo == 0) it.copy(points = 900) else it
            }))
        assertThrows(IllegalStateException::class.java) { poor.markRiichi(0) }
        val reference = LOCAL_TEMPLATES.first { it.key == "reference_4p_competition" }
        val wrc = createLocalMatch(OnlineRules(localTemplateDto(reference)).validated(), reference.key,
            "低点参考", listOf("甲", "乙", "丙", "丁"), 0)
        val lowAllowed = wrc.copy(points = listOf(900, 30000, 30000, 30000),
            currentHand = wrc.currentHand!!.copy(seats = wrc.currentHand.seats.map {
                if (it.seatNo == 0) it.copy(points = 900) else it
            }))
        assertTrue(lowAllowed.markRiichi(0).currentHand!!.seats[0].isRiichi)
    }
    @Test fun scriptedFourHandTrajectoryHasExactBalancesPoolAndFrozenOutputsAfterRestart() {
        val store = LocalMatchStore(context)
        var match = store.create(newMatch())
        assertEquals("E", match.currentHand?.roundWind)
        match = store.change(match.id, match.revision) { it.markRiichi(0) }
        assertEquals(1, match.currentHand!!.seats[0].usage.declares)
        match = store.change(match.id, match.revision) { it.settle(ron(1, 2)) }
        assertEquals(listOf(24000, 28000, 23000, 25000), match.points)
        assertEquals(0, match.nextHand!!.riichiPool)
        assertEquals(0L, match.results.last().output.perSeat.sumOf { it.netPoints.toLong() })
        match = store.change(match.id, match.revision) { it.openHand() }
        assertEquals(RiichiUsage(), match.currentHand!!.seats[0].usage)
        match = store.change(match.id, match.revision) { it.settle(tsumo(1)) }
        assertEquals(listOf(23000, 31000, 22000, 24000), match.points)
        assertEquals(0, match.nextHand!!.riichiPool)
        assertEquals(1, match.nextHand!!.honba)
        match = store.change(match.id, match.revision) { it.openHand() }
        match = store.change(match.id, match.revision) { it.markRiichi(1) }
        assertEquals(1, LocalMatchStore(context).get(match.id)!!.currentHand!!.seats[1].usage.declares)
        match = store.change(match.id, match.revision) { it.settle(draw(1)) }
        assertEquals(listOf(22000, 33000, 21000, 23000), match.points)
        assertEquals(1000, match.nextHand!!.riichiPool)
        assertEquals(2, match.nextHand!!.honba)
        assertEquals(-1000L, match.results.last().output.perSeat.sumOf { it.netPoints.toLong() })
        assertEquals(0L, match.results.last().output.perSeat.sumOf { it.netPoints.toLong() } +
            match.nextHand!!.riichiPool - match.results.last().hand.riichiPool)
        match = store.change(match.id, match.revision) { it.openHand() }
        match = store.change(match.id, match.revision) { it.settle(ron(3, 0)) }
        assertEquals(listOf(19400, 33000, 21000, 26600), match.points)
        assertEquals(0, match.nextHand!!.riichiPool)
        assertEquals(4, match.results.size)
        assertEquals(match, LocalMatchStore(context).get(match.id))
        assertEquals(4, LocalMatchStore(context).list().single().results.size)
        assertEquals(listOf(-2600, 0, 0, 3600), match.results.last().output.perSeat.sortedBy { it.seatNo }.map { it.netPoints })
    }
    @Test fun perSeatBudgetRevisionsAndAbandonNeverDeductUnsettledRiichi() {
        var match = newMatch().markRiichi(0).markRiichi(0).markRiichi(0)
        assertEquals(RiichiUsage(2, 1), match.currentHand!!.seats[0].usage)
        assertThrows(IllegalStateException::class.java) { match.markRiichi(0) }
        assertEquals(25000, match.points[0]); assertEquals(0, match.nextHand!!.riichiPool)
        assertThrows(IllegalStateException::class.java) { match.finish() }
        val eligible = match.copy(points = listOf(30000, 24000, 23000, 23000))
        val finished = eligible.finish()
        assertNull(finished.currentHand)
        assertEquals(eligible.points, finished.points)
        assertEquals(0, finished.nextHand!!.riichiPool)
        assertTrue(finished.results.isEmpty())
        val terminal = finished.confirmTerminal()
        assertTrue(terminal.settlementConfirmed)
        assertTrue(terminal.terminal!!.isGameEnd)
        assertEquals(eligible.points, terminal.points)
    }
    @Test fun transactionRollsBackJournalAndBalancesOnWriteFailureAndRejectsDuplicateOrStaleView() {
        val store = LocalMatchStore(context)
        var match = store.create(newMatch())
        val first = match
        match = store.change(match.id, match.revision) { it.markRiichi(0) }
        assertThrows(IllegalStateException::class.java) {
            store.change(first.id, first.revision) { it.settle(ron(1, 2)) }
        }
        val db = SQLiteDatabase.openDatabase(context.getDatabasePath(LocalMatchStore.DB_NAME).path, null,
            SQLiteDatabase.OPEN_READWRITE)
        db.execSQL("CREATE TRIGGER fail_settlement BEFORE INSERT ON settlement_journal BEGIN SELECT RAISE(ABORT, 'disk failure'); END")
        db.close()
        assertThrows(Exception::class.java) { store.change(match.id, match.revision) { it.settle(ron(1, 2)) } }
        assertEquals(match, LocalMatchStore(context).get(match.id))
        assertEquals(0, LocalMatchStore(context).get(match.id)!!.results.size)
        val journal = SQLiteDatabase.openDatabase(context.getDatabasePath(LocalMatchStore.DB_NAME).path, null,
            SQLiteDatabase.OPEN_READONLY)
        journal.rawQuery("SELECT COUNT(*) FROM settlement_journal", null).use { it.moveToFirst(); assertEquals(0, it.getInt(0)) }
        journal.close()
        val db2 = SQLiteDatabase.openDatabase(context.getDatabasePath(LocalMatchStore.DB_NAME).path, null,
            SQLiteDatabase.OPEN_READWRITE)
        db2.execSQL("DROP TRIGGER fail_settlement"); db2.close()
        val settled = store.change(match.id, match.revision) { it.settle(ron(1, 2)) }
        assertEquals(1, settled.results.size)
        val committed = SQLiteDatabase.openDatabase(context.getDatabasePath(LocalMatchStore.DB_NAME).path, null,
            SQLiteDatabase.OPEN_READONLY)
        committed.rawQuery("SELECT COUNT(*) FROM settlement_journal", null).use { it.moveToFirst(); assertEquals(1, it.getInt(0)) }
        committed.close()
        assertThrows(IllegalStateException::class.java) { store.change(match.id, match.revision) { it.settle(ron(1, 2)) } }
    }
    @Test fun corruptPayloadAndUnknownSchemaSurfaceErrorsWithoutDeletingBytes() {
        val store = LocalMatchStore(context)
        val match = store.create(newMatch())
        val db = SQLiteDatabase.openDatabase(context.getDatabasePath(LocalMatchStore.DB_NAME).path, null,
            SQLiteDatabase.OPEN_READWRITE)
        db.execSQL("UPDATE matches SET payload = ? WHERE id = ?", arrayOf("{broken", match.id))
        db.close()
        assertThrows(IllegalStateException::class.java) { LocalMatchStore(context).list() }
        val verify = SQLiteDatabase.openDatabase(context.getDatabasePath(LocalMatchStore.DB_NAME).path, null,
            SQLiteDatabase.OPEN_READONLY)
        val bytes = verify.rawQuery("SELECT payload FROM matches WHERE id = ?", arrayOf(match.id)).use { cursor ->
            cursor.moveToFirst(); cursor.getString(0)
        }
        assertEquals("{broken", bytes); verify.close()
        val db2 = SQLiteDatabase.openDatabase(context.getDatabasePath(LocalMatchStore.DB_NAME).path, null,
            SQLiteDatabase.OPEN_READWRITE)
        db2.execSQL("UPDATE schema_marker SET version = 2 WHERE id = 1"); db2.close()
        assertThrows(IllegalStateException::class.java) { LocalMatchStore(context).list() }
        val db3 = SQLiteDatabase.openDatabase(context.getDatabasePath(LocalMatchStore.DB_NAME).path, null,
            SQLiteDatabase.OPEN_READONLY)
        db3.rawQuery("SELECT version FROM schema_marker", null).use { it.moveToFirst(); assertEquals(2, it.getInt(0)) }
        db3.close()
        val upgrade = SQLiteDatabase.openDatabase(context.getDatabasePath(LocalMatchStore.DB_NAME).path, null,
            SQLiteDatabase.OPEN_READWRITE)
        upgrade.execSQL("UPDATE schema_marker SET version = 1 WHERE id = 1")
        upgrade.version = 2
        upgrade.close()
        assertThrows(IllegalStateException::class.java) { LocalMatchStore(context).list() }
        val preserved = SQLiteDatabase.openDatabase(context.getDatabasePath(LocalMatchStore.DB_NAME).path, null,
            SQLiteDatabase.OPEN_READONLY)
        preserved.rawQuery("SELECT payload FROM matches WHERE id = ?", arrayOf(match.id)).use {
            it.moveToFirst(); assertEquals("{broken", it.getString(0))
        }
        preserved.close()
    }
    @Test fun draftAndUnknownEngineSurviveRestartWithoutRecomputingHistory() {
        val store = LocalMatchStore(context)
        var match = store.create(newMatch())
        val draft = ResultDraft(kind = "ron", winners = listOf(WinnerDraft(1, han = "3")), dealInSeatNo = 2)
        match = store.change(match.id, match.revision) { it.copy(draft = draft) }
        assertEquals(draft, LocalMatchStore(context).get(match.id)?.draft)
        match = store.change(match.id, match.revision) { it.settle(ron(1, 2)) }
        val output = match.results.single().output
        val unsupported = store.change(match.id, match.revision) { it.copy(engineVersion = "unknown") }
        assertEquals(output, LocalMatchStore(context).get(unsupported.id)?.results?.single()?.output)
        assertThrows(IllegalStateException::class.java) {
            unsupported.openHand().previewResult(ron(1, 2))
        }
    }
    @Test fun rankedSanmaAutomaticallyEndsOnWestThreeAndSavesTerminalStandings() {
        val seed = LOCAL_TEMPLATES.first { it.key == "reference_3p_common" }
        val rule = OnlineRules(localTemplateDto(seed))
        val initial = createLocalMatch(rule.validated(), seed.key, "三麻", listOf("甲", "乙", "丙"), 2)
        val westThree = initial.copy(points = listOf(41000, 35000, 29000), currentHand =
            initial.currentHand!!.copy(roundWind = "W", roundNumber = 3,
                seats = initial.currentHand.seats.map { it.copy(points = listOf(41000, 35000, 29000)[it.seatNo]) }),
            nextHand = NextHandDto("W", 3, 2, 0, 0))
        val store = LocalMatchStore(context)
        var match = store.create(westThree)
        assertThrows(IllegalStateException::class.java) { match.finish() }
        match = store.change(match.id, match.revision) { it.settle(buildJsonObject {
            put("kind", "ryuukyoku"); put("winners", buildJsonArray {})
            put("tenpai", buildJsonArray { repeat(3) { add(true) } })
        }) }
        assertEquals("finished", match.status)
        assertNull(match.currentHand)
        assertEquals(listOf(41000, 35000, 29000), match.points)
        val preview = match.previewTerminal()
        assertEquals(3, preview.perSeat.size)
        assertTrue(preview.isGameEnd)
        assertEquals(3, preview.standings.size)
        assertEquals(preview.perSeat.map { it.totalTenths }, preview.tenths)
        assertEquals(listOf(1, 2, 3), preview.standings.map { it.rank })
        assertEquals(listOf(1, 2, 3), preview.perSeat.sortedBy { it.rank }.map { it.rank })
        match = store.change(match.id, match.revision) { it.confirmTerminal() }
        assertTrue(match.settlementConfirmed)
        assertEquals(preview, LocalMatchStore(context).get(match.id)?.terminal)
    }
    @Test fun invalidStoredUsageIsRejectedWithoutRewritingTheDatabase() {
        val store = LocalMatchStore(context)
        val original = store.create(newMatch())
        val hand = original.currentHand!!
        val bad = original.copy(currentHand = hand.copy(seats = hand.seats.map {
            if (it.seatNo == 0) it.copy(isRiichi = true, usage = RiichiUsage(3, 0)) else it
        }))
        val raw = Json.encodeToString(bad)
        val db = SQLiteDatabase.openDatabase(context.getDatabasePath(LocalMatchStore.DB_NAME).path, null,
            SQLiteDatabase.OPEN_READWRITE)
        db.execSQL("UPDATE matches SET payload = ? WHERE id = ?", arrayOf(raw, original.id))
        db.close()
        assertThrows(IllegalStateException::class.java) { LocalMatchStore(context).list() }
        val preserved = SQLiteDatabase.openDatabase(context.getDatabasePath(LocalMatchStore.DB_NAME).path, null,
            SQLiteDatabase.OPEN_READONLY)
        preserved.rawQuery("SELECT payload FROM matches WHERE id = ?", arrayOf(original.id)).use {
            it.moveToFirst(); assertEquals(raw, it.getString(0))
        }
        preserved.close()
    }
    @Test fun finishedTableAllowsOnlyTerminalConfirmation() {
        val store = LocalMatchStore(context)
        val original = newMatch().copy(points = listOf(30000, 24000, 23000, 23000))
        val finished = store.create(original.finish())
        assertThrows(IllegalStateException::class.java) { finished.renameSeat(0, "不可更名") }
        assertThrows(IllegalStateException::class.java) {
            store.change(finished.id, finished.revision) { it.copy(points = listOf(31000, 23000, 23000, 23000)) }
        }
        val confirmed = store.change(finished.id, finished.revision) { it.confirmTerminal() }
        assertTrue(confirmed.terminal!!.isGameEnd)
        assertThrows(IllegalStateException::class.java) {
            store.change(confirmed.id, confirmed.revision) { it.renameSeat(0, "不可更名") }
        }
    }
    @Test fun finishedHistoryCannotBeRewrittenAndDeleteRemovesEntireTable() {
        val store = LocalMatchStore(context)
        var match = store.create(newMatch())
        val other = store.create(newMatch().copy(id = "local-other"))
        match = store.change(match.id, match.revision) { it.settle(tsumo(0)) }
        assertThrows(IllegalStateException::class.java) { store.change(match.id, match.revision) { it.copy(results = emptyList()) } }
        val frozen = LocalMatchStore(context).get(match.id)!!.results
        assertEquals(1, frozen.size)
        store.delete(match.id)
        assertEquals(other, LocalMatchStore(context).list().single())
    }
}
