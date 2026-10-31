-- D30: the owner wants the PO rule on the orders already running. Workflow v3 differs from v2
-- only by requiring each component's purchase order (PO) before "ordered" and before the
-- hand-over to Production, so unfinished v2 orders move to v3. Finished ones keep v2.
UPDATE "orders"
   SET "template_version" = 3
 WHERE "template_key" = 'export-order'
   AND "template_version" = 2
   AND "status" IN ('ACTIVE', 'NO_ACTION_NEEDED');
