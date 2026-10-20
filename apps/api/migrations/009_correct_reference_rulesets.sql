-- Correct only the existing v1 WRC and Tenhou reference configurations. Existing
-- match snapshots stay unchanged; template review statuses and house rows stay unchanged.
-- The versions table normally rejects updates: narrowly suspend its immutability
-- trigger within the migration transaction while repairing these two seeded rows.
SET LOCAL search_path TO app, public;

ALTER TABLE ruleset_versions DISABLE TRIGGER tg_ruleset_versions_immutable;

WITH corrections (template_key, patch) AS (
  VALUES
  ('reference_4p_competition', $json${
    "templateKey": "wrc_4p_ref_v1",
    "playerCount": 4,
    "startingPoints": 30000,
    "returnPoints": 30000,
    "targetPoints": 30000,
    "uma": [15, 5, -5, -15],
    "oka": 0,
    "riichiStick": 1000,
    "akaDora": {"man": 0, "pin": 0, "sou": 0},
    "tsumoLoss": false,
    "notenPenaltyTotal": 3000,
    "honbaRon": 300,
    "honbaPerPayer": 100,
    "multiRon": "head_bump",
    "doubleRonHonbaPolicy": "nearest_only",
    "kiriageMangan": true,
    "kazoeYakuman": true,
    "compositeYakuman": true,
    "doubleYakuman": false,
    "nagashiManganEnabled": false,
    "bustEndsGame": false,
    "allowLowPointRiichi": true,
    "terminalRiichiPoolPolicy": "unallocated",
    "tiedUmaPolicy": "split",
    "fixedSouth4EndPolicy": "completed_south_4",
    "automaticEndPolicy": "manual",
    "pendingReview": ["competition_penalties"]
  }$json$::jsonb),
  ('reference_3p_common', $json${
    "templateKey": "common_3p_ref_v1",
    "playerCount": 3,
    "startingPoints": 35000,
    "returnPoints": 40000,
    "targetPoints": 40000,
    "uma": [20, 0, -20],
    "oka": 15,
    "riichiStick": 1000,
    "tsumoLoss": true,
    "notenPenaltyTotal": 2000,
    "honbaRon": 200,
    "honbaPerPayer": 100,
    "multiRon": "double_ron",
    "doubleRonHonbaPolicy": "nearest_only",
    "kiriageMangan": false,
    "kazoeYakuman": true,
    "compositeYakuman": true,
    "doubleYakuman": false,
    "nagashiManganEnabled": true,
    "nagashiDealerRepeatRequiresTenpai": true,
    "nagashiCollectsRiichiPool": false,
    "bustEndsGame": true,
    "allowLowPointRiichi": false,
    "terminalRiichiPoolPolicy": "first",
    "tiedUmaPolicy": "seat_order",
    "fixedSouth4EndPolicy": "target_or_bust",
    "automaticEndPolicy": "ranked_sanma",
    "pendingReview": [
      "ryuukyoku_penalty_2000_candidate",
      "tile_set", "kita_nukidora", "dora", "end_conditions", "payments"
    ]
  }$json$::jsonb)
), corrected AS (
  SELECT v.id, (v.config - ARRAY[
    'umaTenths', 'okaTenths', 'tsumoPayment', 'ryuukyokuPenaltyTotal',
    'honba', 'multipleRon'
  ]) || c.patch AS config
  FROM ruleset_versions v
  JOIN ruleset_templates t ON t.id = v.template_id
  JOIN corrections c ON c.template_key = t.template_key
  WHERE t.scope = 'system' AND v.version = 1
)
UPDATE ruleset_versions v
SET config = c.config,
    config_hash = encode(sha256(convert_to(c.config::text, 'UTF8')), 'hex')
FROM corrected c
WHERE v.id = c.id AND (v.config IS DISTINCT FROM c.config OR
                      v.config_hash IS DISTINCT FROM encode(sha256(convert_to(c.config::text, 'UTF8')), 'hex'));

ALTER TABLE ruleset_versions ENABLE TRIGGER tg_ruleset_versions_immutable;
