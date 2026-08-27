WITH entries AS (
  SELECT 'table|' || c.relname || '|' || c.relkind::text || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text AS entry
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')

  UNION ALL
  SELECT 'column|' || c.relname || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod)
    || '|' || a.attnotnull::text || '|' || a.attidentity::text || '|' || a.attgenerated::text
    || '|' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '')
    || '|' || COALESCE(coll.collname, '')
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  LEFT JOIN pg_collation coll ON coll.oid = a.attcollation AND a.attcollation <> 0
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped

  UNION ALL
  SELECT 'constraint|' || c.relname || '|' || con.contype::text || '|' || pg_get_constraintdef(con.oid, true)
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND con.contype <> 'u'

  UNION ALL
  SELECT 'index|' || tablename || '|' || regexp_replace(
    indexdef,
    '^CREATE (UNIQUE )?INDEX [^ ]+ ON ',
    'CREATE \1INDEX ON '
  )
  FROM pg_indexes WHERE schemaname = 'public'

  UNION ALL
  SELECT 'enum|' || t.typname || '|' || e.enumlabel || '|' || e.enumsortorder::text
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE n.nspname = 'public'

  UNION ALL
  SELECT 'function|' || p.proname || '|' || pg_get_function_identity_arguments(p.oid) || '|' || md5(pg_get_functiondef(p.oid))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'

  UNION ALL
  SELECT 'trigger|' || c.relname || '|' || t.tgname || '|' || md5(pg_get_triggerdef(t.oid, true))
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal

  UNION ALL
  SELECT 'sequence|' || c.relname || '|' || s.seqtypid::text || '|' || s.seqstart::text || '|' || s.seqincrement::text
    || '|' || s.seqmax::text || '|' || s.seqmin::text || '|' || s.seqcache::text || '|' || s.seqcycle::text
  FROM pg_sequence s
  JOIN pg_class c ON c.oid = s.seqrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'

  UNION ALL
  SELECT 'view|' || c.relname || '|' || md5(pg_get_viewdef(c.oid, true))
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
)
SELECT entry FROM entries ORDER BY entry;
