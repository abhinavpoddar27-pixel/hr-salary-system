/**
 * Multipart upload helper for the external-grants route, over the apiHarness
 * socket. No new dependency: node's own http client and SheetJS.
 */
const http = require('http');
const XLSX = require('xlsx');

function sheet(rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function uploadGrants(api, buffer, query = '', filename = 'leave.xlsx') {
  return new Promise((resolve, reject) => {
    const boundary = '----grantstest';
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n'
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const payload = Buffer.concat([head, buffer, tail]);
    const req = http.request({
      host: '127.0.0.1', port: api.server.address().port, method: 'POST',
      path: `/api/features/leave-external-grants/upload${query}`,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': payload.length },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, body: json, text });
      });
    });
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

module.exports = { sheet, uploadGrants };
