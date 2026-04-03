const { paginateQuery } = require('../utils/pagination');

// Mock SQLite db
function createMockDb(data) {
  return {
    prepare: (sql) => ({
      all: (...params) => {
        if (sql.includes('LIMIT')) {
          const limitMatch = params;
          const limit = limitMatch[limitMatch.length - 2];
          const offset = limitMatch[limitMatch.length - 1];
          return data.slice(offset, offset + limit);
        }
        return data;
      },
      get: () => ({ cnt: data.length })
    })
  };
}

describe('Pagination Utility', () => {
  const testData = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `Employee ${i + 1}` }));

  test('returns all data when no page param', () => {
    const db = createMockDb(testData);
    const result = paginateQuery(db, { baseQuery: 'SELECT *', countQuery: 'SELECT COUNT(*) as cnt', params: [] });
    expect(result.data.length).toBe(100);
    expect(result.totalPages).toBe(1);
  });

  test('paginates correctly with page param', () => {
    const db = createMockDb(testData);
    const result = paginateQuery(db, {
      baseQuery: 'SELECT *', countQuery: 'SELECT COUNT(*) as cnt',
      params: [], page: 1, limit: 10
    });
    expect(result.data.length).toBe(10);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
    expect(result.total).toBe(100);
    expect(result.totalPages).toBe(10);
  });

  test('page 2 starts at correct offset', () => {
    const db = createMockDb(testData);
    const result = paginateQuery(db, {
      baseQuery: 'SELECT *', countQuery: 'SELECT COUNT(*) as cnt',
      params: [], page: 2, limit: 25
    });
    expect(result.data[0].id).toBe(26);
    expect(result.page).toBe(2);
  });

  test('limit is capped at 200', () => {
    const db = createMockDb(testData);
    const result = paginateQuery(db, {
      baseQuery: 'SELECT *', countQuery: 'SELECT COUNT(*) as cnt',
      params: [], page: 1, limit: 500
    });
    expect(result.pageSize).toBe(200);
  });
});
