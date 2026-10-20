-- 数据库设计 v1.3 §3.2 (user_default_rulesets), §4 (ruleset_templates, ruleset_versions).

SET LOCAL search_path TO app, public;

CREATE TABLE ruleset_templates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key       text NULL UNIQUE,
  owner_principal_id uuid NULL REFERENCES principals (id),
  scope              text NOT NULL CHECK (scope IN ('system', 'private')),
  name               text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  player_count       smallint NOT NULL CHECK (player_count IN (3, 4)),
  source_label       text NULL,
  source_url         text NULL,
  -- system presets: 'pending' until phase-A source verification, else 'reviewed';
  -- private templates are validated by the service on save and carry no review state.
  review_status      text NOT NULL CHECK (review_status IN ('pending', 'reviewed', 'not_applicable')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- System templates: fixed seed key, no owner. Private: owner required (service
  -- verifies it is a formal account), no seed key.
  CONSTRAINT ck_ruleset_templates_scope CHECK (
    (scope = 'system' AND template_key IS NOT NULL AND owner_principal_id IS NULL
       AND review_status IN ('pending', 'reviewed'))
    OR (scope = 'private' AND template_key IS NULL AND owner_principal_id IS NOT NULL
       AND review_status = 'not_applicable')
  ),
  -- Target for (template_id, player_count) FK: version player count must equal template's.
  CONSTRAINT uq_ruleset_templates_id_player_count UNIQUE (id, player_count)
);
CREATE INDEX ix_ruleset_templates_owner ON ruleset_templates (owner_principal_id, player_count);

CREATE TRIGGER tg_ruleset_templates_updated_at
  BEFORE UPDATE ON ruleset_templates
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- System templates are read-only presets: never deleted; identity columns of any
-- template never change (player count is the template type).
CREATE FUNCTION app.ruleset_templates_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.scope = 'system' THEN
      RAISE EXCEPTION 'system ruleset template % is read-only', OLD.template_key
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.scope IS DISTINCT FROM OLD.scope
     OR NEW.template_key IS DISTINCT FROM OLD.template_key
     OR NEW.player_count IS DISTINCT FROM OLD.player_count
     OR (OLD.scope = 'system' AND NEW.owner_principal_id IS NOT NULL) THEN
    RAISE EXCEPTION 'ruleset template % identity columns are immutable', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tg_ruleset_templates_guard
  BEFORE UPDATE OR DELETE ON ruleset_templates
  FOR EACH ROW EXECUTE FUNCTION app.ruleset_templates_guard();

-- Versions only grow and never change. Deleting a private template (account
-- erasure) removes its versions; matches keep their own rules_snapshot.
CREATE TABLE ruleset_versions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id           uuid NOT NULL,
  version               integer NOT NULL CHECK (version >= 1),
  player_count          smallint NOT NULL CHECK (player_count IN (3, 4)),
  config                jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  config_hash           text NOT NULL,
  config_schema_version integer NOT NULL CHECK (config_schema_version >= 1),
  engine_version        text NOT NULL,
  published_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_ruleset_versions_template FOREIGN KEY (template_id, player_count)
    REFERENCES ruleset_templates (id, player_count) ON DELETE CASCADE,
  CONSTRAINT uq_ruleset_versions_id_player_count UNIQUE (id, player_count)
);
-- Covers both the (template_id, version) uniqueness and the latest-version lookup.
CREATE UNIQUE INDEX uq_ruleset_versions_template_version
  ON ruleset_versions (template_id, version DESC);

CREATE FUNCTION app.reject_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER tg_ruleset_versions_immutable
  BEFORE UPDATE ON ruleset_versions
  FOR EACH ROW EXECUTE FUNCTION app.reject_update();

-- P1 feature; table exists so the schema is complete, no P0 code path writes it.
-- Service restricts targets to system presets or the principal's own unarchived templates.
CREATE TABLE user_default_rulesets (
  principal_id       uuid NOT NULL REFERENCES principals (id),
  player_count       smallint NOT NULL CHECK (player_count IN (3, 4)),
  ruleset_version_id uuid NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_id, player_count),
  CONSTRAINT fk_user_default_rulesets_version FOREIGN KEY (ruleset_version_id, player_count)
    REFERENCES ruleset_versions (id, player_count) ON DELETE CASCADE
);
