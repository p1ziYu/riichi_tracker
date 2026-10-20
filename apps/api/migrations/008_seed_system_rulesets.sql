-- Seed: four read-only system ruleset templates and their v1 versions.
-- Sources: 日麻三端产品计划书 v1.3 §4.2; 数据库设计 v1.3 §4.
--
-- Reference presets stay review_status='pending' until the phase-A source comparison
-- (WRC 2025 / Tenhou 3p) is done; they must not be labelled compatible/official before.
-- House templates are this product's own rules and are 'reviewed'.
--
-- config_schema_version 1 conventions:
--   points are integers; competition score (uma/oka) is in tenths of a point;
--   uma/oka in config are the template's values, oka = (return - start) * players / 1000;
--   honba.ronTotal = honba.tsumoPerPayer * (players - 1) (ron and tsumo totals must match);
--   pendingReview lists items not yet verified against the source (reference presets only).
-- config_hash = hex sha256 of the PostgreSQL canonical jsonb text (config::text).
-- engine_version tracks @riichi/engine ENGINE_VERSION.

SET LOCAL search_path TO app, public;

WITH seed (template_key, name, player_count, source_label, source_url, review_status, config) AS (
  VALUES
  ('reference_4p_competition', '四麻国际竞技参考', 4::smallint,
   'WRC Rules 2025（参考，待阶段 A 核对）', 'https://www.worldriichi.org/wrc-rules', 'pending',
   $json${
     "playerCount": 4,
     "startingPoints": 30000,
     "returnPoints": 30000,
     "umaTenths": [150, 50, -50, -150],
     "okaTenths": 0,
     "riichiStick": 1000,
     "akaDora": {"man": 0, "pin": 0, "sou": 0},
     "tsumoPayment": "standard",
     "ryuukyokuPenaltyTotal": 3000,
     "honba": {"ronTotal": 300, "tsumoPerPayer": 100},
     "multipleRon": "head_bump",
     "pendingReview": [
       "low_point_riichi",
       "negative_score_continuation",
       "tied_rank_uma_split",
       "final_riichi_pool_unallocated",
       "competition_penalties"
     ]
   }$json$::jsonb),

  ('reference_3p_common', '三麻常见玩法参考', 3::smallint,
   '天凤三麻说明（参考，待阶段 A 核对）', 'https://tenhou.net/man/index.html', 'pending',
   $json${
     "playerCount": 3,
     "startingPoints": 35000,
     "returnPoints": 40000,
     "umaTenths": [200, 0, -200],
     "okaTenths": 150,
     "riichiStick": 1000,
     "tsumoPayment": "tsumo_loss",
     "ryuukyokuPenaltyTotal": 2000,
     "honba": {"ronTotal": 200, "tsumoPerPayer": 100},
     "pendingReview": [
       "ryuukyoku_penalty_2000_candidate",
       "tile_set",
       "kita_nukidora",
       "dora",
       "end_conditions",
       "payments"
     ]
   }$json$::jsonb),

  ('house_4p', '四麻家规', 4::smallint,
   '本产品家规示例', NULL, 'reviewed',
   $json${
     "playerCount": 4,
     "startingPoints": 25000,
     "returnPoints": 30000,
     "umaTenths": [200, 100, -100, -200],
     "okaTenths": 200,
     "riichiStick": 1000,
     "kuitan": true,
     "akaDora": {"man": 1, "pin": 1, "sou": 1},
     "kiriageMangan": false,
     "kazoeYakuman": "single_yakuman_at_13_han",
     "compositeYakuman": true,
     "doubleYakuman": false,
     "doubleWindPair": "fu_4",
     "tsumoPayment": "standard",
     "honba": {"ronTotal": 300, "tsumoPerPayer": 100},
     "ryuukyokuPenaltyTotal": 3000,
     "multipleRon": {"double": "allowed", "triple": "abortive_draw"},
     "multipleRonPool": "nearest_winner_after_discarder",
     "multipleRonHonba": "each_winner",
     "bustEndsBelowZero": true,
     "tiebreak": "initial_seat_order",
     "autoNagashiMangan": false,
     "autoPao": false,
     "autoChomboPenalty": false
   }$json$::jsonb),

  ('house_3p', '三麻家规', 3::smallint,
   '本产品家规示例', NULL, 'reviewed',
   $json${
     "playerCount": 3,
     "startingPoints": 35000,
     "returnPoints": 40000,
     "umaTenths": [200, 0, -200],
     "okaTenths": 150,
     "riichiStick": 1000,
     "kuitan": true,
     "akaDora": {"man": 0, "pin": 1, "sou": 1},
     "kiriageMangan": false,
     "kazoeYakuman": "single_yakuman_at_13_han",
     "compositeYakuman": true,
     "doubleYakuman": false,
     "doubleWindPair": "designated_round_and_seat_wind",
     "tsumoPayment": "tsumo_loss",
     "honba": {"ronTotal": 200, "tsumoPerPayer": 100},
     "ryuukyokuPenaltyTotal": 3000,
     "multipleRon": {"double": "allowed"},
     "multipleRonPool": "nearest_winner_after_discarder",
     "multipleRonHonba": "each_winner",
     "bustEndsBelowZero": true,
     "tiebreak": "initial_seat_order",
     "autoNagashiMangan": false,
     "autoPao": false,
     "autoChomboPenalty": false
   }$json$::jsonb)
),
templates AS (
  INSERT INTO ruleset_templates (template_key, scope, name, player_count, source_label, source_url, review_status)
  SELECT template_key, 'system', name, player_count, source_label, source_url, review_status
    FROM seed
  RETURNING id, template_key, player_count
)
INSERT INTO ruleset_versions (template_id, version, player_count, config, config_hash,
                              config_schema_version, engine_version)
SELECT t.id, 1, t.player_count, s.config,
       encode(sha256(convert_to(s.config::text, 'UTF8')), 'hex'),
       1, '0.1.0'
  FROM templates t
  JOIN seed s USING (template_key);
