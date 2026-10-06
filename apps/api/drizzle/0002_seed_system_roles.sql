-- The four base roles (plan.md §4.1, D3). Admin can add more custom-named roles later.
INSERT INTO "roles" ("name", "permission", "is_system") VALUES
  ('Admin', 'ADMIN', true),
  ('Creator', 'CREATOR', true),
  ('Approver', 'APPROVER', true),
  ('CFO', 'CFO', true)
ON CONFLICT ((lower("name"))) DO NOTHING;
