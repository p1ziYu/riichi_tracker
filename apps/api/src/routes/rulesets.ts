import { normalizeRulesConfig } from '@riichi/engine';
import type { FastifyInstance } from 'fastify';
import { resolvePrincipal } from '../auth.js';
import { pool } from '../db.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function prepareEngineRulesConfig(rawConfig: Record<string, unknown>): Record<string, unknown> {
  const multipleRon = rawConfig.multipleRon;
  let derivedMultiRon = rawConfig.multiRon;
  if (derivedMultiRon === undefined) {
    if (
      multipleRon === 'head_bump' ||
      (typeof multipleRon === 'object' &&
        multipleRon !== null &&
        (multipleRon as Record<string, unknown>).double === 'head_bump')
    ) {
      derivedMultiRon = 'head_bump';
    } else if (
      multipleRon === 'allow_all' ||
      (typeof multipleRon === 'object' &&
        multipleRon !== null &&
        (multipleRon as Record<string, unknown>).triple === 'allow')
    ) {
      derivedMultiRon = 'allow_all';
    }
  }
  return derivedMultiRon !== undefined ? { ...rawConfig, multiRon: derivedMultiRon } : rawConfig;
}

export function enrichRulesetConfig(rawConfig: Record<string, unknown>, playerCount: number): Record<string, unknown> {
  const norm = normalizeRulesConfig(prepareEngineRulesConfig(rawConfig), playerCount);
  const akaObj =
    typeof rawConfig.akaDora === 'object' && rawConfig.akaDora !== null
      ? (rawConfig.akaDora as Record<string, number>)
      : undefined;
  const redFivesFromAka = akaObj
    ? (Number(akaObj.man ?? 0) + Number(akaObj.pin ?? 0) + Number(akaObj.sou ?? 0))
    : norm.playerCount === 3
      ? 2
      : 3;

  return {
    ...rawConfig,
    playerCount: norm.playerCount,
    startingPoints: norm.startingPoints,
    startPoints: (rawConfig.startPoints as number | undefined) ?? norm.startingPoints,
    returnPoints: norm.returnPoints,
    uma: (rawConfig.uma as number[] | undefined) ?? norm.uma,
    umaTenths: (rawConfig.umaTenths as number[] | undefined) ?? norm.uma.map((u) => Math.round(u * 10)),
    okaTenths: (rawConfig.okaTenths as number | undefined) ?? Math.round(norm.oka * 10),
    ryuukyokuPenaltyTotal: norm.notenPenaltyTotal,
    ryuukyokuPoolTotal: (rawConfig.ryuukyokuPoolTotal as number | undefined) ?? norm.notenPenaltyTotal,
    honbaPerPayer: norm.honbaPerPayer,
    roundLength: (rawConfig.roundLength as string | undefined) ?? 'south',
    endTarget: (rawConfig.endTarget as number | undefined) ?? norm.targetPoints,
    maxRounds: (rawConfig.maxRounds as number | undefined) ?? 12,
    dealerFinish: (rawConfig.dealerFinish as boolean | undefined) ?? true,
    bustEndsMatch: (rawConfig.bustEndsMatch as boolean | undefined) ?? norm.bustEndsGame,
    openTanyao: (rawConfig.openTanyao as boolean | undefined) ?? Boolean(rawConfig.kuitan ?? true),
    redFives: (rawConfig.redFives as number | undefined) ?? redFivesFromAka,
    kiriageMangan: norm.kiriageMangan,
    kazoeYakuman: rawConfig.kazoeYakuman ?? norm.kazoeYakuman,
    sanmaTsumoLoss: (rawConfig.sanmaTsumoLoss as boolean | undefined) ?? norm.tsumoLoss,
    doubleRon: (rawConfig.doubleRon as boolean | undefined) ?? (norm.multiRon !== 'head_bump'),
  };
}

export function registerRulesetsRoutes(app: FastifyInstance): void {
  // Final-native Round 1: template endpoints retired (410). Template rows
  // stay in the database untouched; only the HTTP surface is gone.
  // enrichRulesetConfig / prepareEngineRulesConfig above are kept exported
  // because the legacy match-creation branch still imports them.
  app.get('/api/rulesets/templates', async (_req, reply) => {
    return reply.code(410).send({
      error: 'templates_retired',
      message: 'Ruleset templates are retired; create matches with { mode } instead.',
    });
  });

  app.get<{ Params: { versionId: string } }>('/api/rulesets/versions/:versionId', async (_req, reply) => {
    return reply.code(410).send({
      error: 'templates_retired',
      message: 'Ruleset templates are retired; create matches with { mode } instead.',
    });
  });
}
