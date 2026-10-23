package com.p1ziyu.riichitracker.p1

import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.TimeZone

internal fun isFinishedMatch(status: String): Boolean = when (status.lowercase(Locale.ROOT)) {
    "finished", "completed", "settled" -> true
    else -> false
}

// /api/matches?mine=1 already restricts to matches this account owns or participates in.
internal fun finishedOwnMatches(matches: List<MatchSummary>): List<MatchSummary> =
    matches.filter { isFinishedMatch(it.status) }.sortedByDescending { it.createdAt }

internal fun ownHistoryMatches(matches: List<MatchSummary>): List<MatchSummary> =
    matches.sortedByDescending { it.createdAt }

internal fun matchStatusLabel(status: String): String = when (status.lowercase(Locale.ROOT)) {
    "preparing", "lobby" -> "等待座次确认"
    "active", "in_progress" -> "牌局进行中"
    "finished", "completed", "settled" -> "牌局已结束"
    "abandoned", "cancelled" -> "牌局已取消"
    else -> "状态未提供"
}

internal fun reviewLabel(status: String): String = when (status.lowercase(Locale.ROOT)) {
    "approved", "verified" -> "已审核"
    "pending", "unreviewed" -> "待审核"
    "reviewed" -> "已复核"
    "draft" -> "草稿"
    "rejected" -> "未通过"
    else -> "审核状态未提供"
}

internal fun sourceLabel(source: String): String = when (source.lowercase(Locale.ROOT)) {
    "system", "global", "public" -> "系统模板"
    "private", "mine", "user" -> "私有模板"
    else -> "来源未提供"
}

internal fun customRuleLabel(key: String): String = when (key) {
    "honba", "honbaRon", "honbaPerPayer" -> "本场棒"
    "kuitan", "openTanyao" -> "食断"
    "akaDora", "redFives" -> "赤宝牌"
    "autoPao" -> "包牌"
    "tiebreak", "tiedUmaPolicy" -> "同分顺位"
    "multipleRon", "multiRon", "doubleRon", "doubleRonHonbaPolicy", "multipleRonPool" -> "多家荣和"
    "riichiStick", "allowLowPointRiichi" -> "立直"
    "kazoeYakuman", "doubleYakuman", "compositeYakuman" -> "役满"
    "returnPoints", "targetPoints", "startingPoints" -> "点数设置"
    "roundLength", "maxRounds", "dealerFinish", "automaticEndPolicy", "fixedSouth4EndPolicy", "bustEndsGame" -> "终局条件"
    "sanmaTsumoLoss", "tsumoLoss" -> "点数支付"
    "kiriageMangan" -> "切上满贯"
    "notenPenaltyTotal" -> "流局罚符"
    "nagashiManganEnabled", "nagashiCollectsRiichiPool", "nagashiDealerRepeatRequiresTenpai" -> "流局满贯"
    "terminalRiichiPoolPolicy" -> "供托分配"
    "doubleWindPair" -> "连风雀头"
    else -> "其他规则选项"
}

internal fun handKindLabel(kind: String): String = when (kind.lowercase(Locale.ROOT)) {
    "ron" -> "荣和"
    "tsumo" -> "自摸"
    "ryuukyoku" -> "荒牌流局"
    "nagashi_mangan" -> "流局满贯"
    "abortive_draw" -> "途中流局"
    "chombo" -> "犯规罚符"
    else -> "结算类型未提供"
}

internal fun windLabel(wind: String?): String = when (wind?.uppercase(Locale.ROOT)) {
    "E" -> "东"
    "S" -> "南"
    "W" -> "西"
    "N" -> "北"
    else -> "未提供"
}

/** Parse the API's ISO timestamp as an instant; never render UTC as if it were local wall time. */
internal fun localMatchTime(value: String?, timeZone: TimeZone = TimeZone.getDefault()): String {
    if (value.isNullOrBlank()) return "时间未提供"
    return runCatching {
        OffsetDateTime.parse(value, DateTimeFormatter.ISO_OFFSET_DATE_TIME)
            .atZoneSameInstant(timeZone.toZoneId())
            .format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm", Locale.ROOT))
    }.getOrDefault("时间未提供")
}
