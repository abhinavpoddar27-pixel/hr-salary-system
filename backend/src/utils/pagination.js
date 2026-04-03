/**
 * Server-side pagination helper for SQLite queries.
 * Backward compatible: if no `page` param is provided, returns all results.
 */
function paginateQuery(db, { baseQuery, countQuery, params = [], page, limit = 50, sort, order = 'asc', search, searchColumns = [] }) {
  // If no page param, return all results (backward compatibility)
  if (!page) {
    const data = db.prepare(baseQuery).all(...params);
    return { data, total: data.length, page: 1, pageSize: data.length, totalPages: 1 };
  }

  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(limit) || 50));

  // Add search filter
  let searchClause = '';
  const searchParams = [];
  if (search && searchColumns.length > 0) {
    const conditions = searchColumns.map(col => `${col} LIKE ?`);
    searchClause = ` AND (${conditions.join(' OR ')})`;
    searchColumns.forEach(() => searchParams.push(`%${search}%`));
  }

  // Count total
  const countSql = countQuery + searchClause;
  const totalRow = db.prepare(countSql).get(...params, ...searchParams);
  const total = totalRow?.cnt || totalRow?.count || 0;
  const totalPages = Math.ceil(total / pageSize);

  // Add search, sort, pagination to base query
  let dataSql = baseQuery + searchClause;
  if (sort) {
    const dir = order === 'desc' ? 'DESC' : 'ASC';
    dataSql += ` ORDER BY ${sort} ${dir}`;
  }
  dataSql += ` LIMIT ? OFFSET ?`;
  const offset = (pageNum - 1) * pageSize;

  const data = db.prepare(dataSql).all(...params, ...searchParams, pageSize, offset);

  return { data, total, page: pageNum, pageSize, totalPages };
}

module.exports = { paginateQuery };
