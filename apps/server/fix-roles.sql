-- 1. 找出所有应该是 school_principal 但 user.role 不对的
-- (teacher 是某个学校的 currentPrincipalTeacherId)
UPDATE User
SET role = 'school_principal'
WHERE id IN (
  SELECT t.userId
  FROM Teacher t
  INNER JOIN School s ON s.currentPrincipalTeacherId = t.id
  WHERE t.userId IS NOT NULL
);

-- 2. 找出所有 user.role = school_principal 但不是任何学校负责人的
UPDATE User
SET role = 'teacher'
WHERE role = 'school_principal'
AND id IN (
  SELECT t.userId
  FROM Teacher t
  LEFT JOIN School s ON s.currentPrincipalTeacherId = t.id
  WHERE s.id IS NULL
  AND t.userId IS NOT NULL
);
