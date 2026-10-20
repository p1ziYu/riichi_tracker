import { normalizeRulesConfig } from '@riichi/engine';
import type { FastifyInstance } from 'fastify';
import { resolvePrincipal } from '../auth.js';
import { pool } from '../db.js';

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
  app.get('/api/rulesets/templates', async (req) => {
    // D5: system templates for everyone; a signed-in caller also gets their own.
    const principal = await resolvePrincipal(req);
    const res = await pool.query<{
      template_id: string;
      template_key: string | null;
      scope: string;
      name: string;
      player_count: number;
      review_status: string;
      version_id: string;
      config: Record<string, unknown>;
    }>(
      `SELECT DISTINCT ON (t.id)
         t.id AS template_id,
         t.template_key,
         t.scope,
         t.name,
         t.player_count,
         t.review_status,
         v.id AS version_id,
         v.config
       FROM app.ruleset_templates t
       JOIN app.ruleset_versions v ON v.template_id = t.id
       WHERE t.scope = 'system' OR (t.scope = 'private' AND $1::uuid IS NOT NULL AND t.owner_principal_id = $1)
       ORDER BY t.id, v.version DESC`,
      [principal?.status === 'active' ? principal.id : null],
    );

    return res.rows.map((r) => ({
      templateId: r.template_id,
      templateKey: r.template_key ?? r.template_id,
      kind: r.player_count === 3 ? '3p' : '4p',
      scope: r.scope,
      versionId: r.version_id,
      name: r.name,
      reviewStatus: r.review_status,
      config: enrichRulesetConfig(r.config, r.player_count),
    }));
  });

  app.get<{ Params: { versionId: string } }>('/api/rulesets/versions/:versionId', async (req, reply) => {
    const { versionId } = req.params;
    const res = await pool.query<{
      id: string;
      player_count: number;
      config: Record<string, unknown>;
      config_hash: string;
      scope: string;
      owner_principal_id: string | null;
    }>(
      `SELECT v.id, v.player_count, v.config, v.config_hash, t.scope, t.owner_principal_id
       FROM app.ruleset_versions v
       JOIN app.ruleset_templates t ON t.id = v.template_id
       WHERE v.id = $1`,
      [versionId],
    );

    const row = res.rows[0];
    if (!row) {
      return reply.code(404).send({ error: 'not_found', message: 'Ruleset version not found' });
    }

    if (row.scope !== 'system') {
      const principal = await resolvePrincipal(req);
      if (!principal || principal.status !== 'active' || principal.id !== row.owner_principal_id) {
        return reply.code(403).send({
          error: 'forbidden',
          message: 'Private ruleset version is only visible to its owner',
        });
      }
    }

    return {
      versionId: row.id,
      config: enrichRulesetConfig(row.config, row.player_count),
      configHash: row.config_hash,
    };
  });
}
