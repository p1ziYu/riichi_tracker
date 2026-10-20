-- Per-match owner-scoped ruleset versions are deliberately excluded from the template library.
SET LOCAL search_path TO app, public;

ALTER TABLE ruleset_templates DROP CONSTRAINT ck_ruleset_templates_scope;
ALTER TABLE ruleset_templates DROP CONSTRAINT ruleset_templates_scope_check;
ALTER TABLE ruleset_templates ADD CONSTRAINT ruleset_templates_scope_check
  CHECK (scope IN ('system', 'private', 'user'));
ALTER TABLE ruleset_templates ADD CONSTRAINT ck_ruleset_templates_scope CHECK (
  (scope = 'system' AND template_key IS NOT NULL AND owner_principal_id IS NULL
    AND review_status IN ('pending', 'reviewed'))
  OR (scope IN ('private', 'user') AND template_key IS NULL
    AND owner_principal_id IS NOT NULL AND review_status = 'not_applicable')
);
