// tsx --require용 모킹 로더
// mcp-server.ts가 './db'를 import할 때 가짜 db/hashContent를 제공한다.

const Module = require('module');
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function (request, parent, isMain, options) {
  if (parent && parent.filename && parent.filename.endsWith('mcp-server.ts')) {
    if (request === './db' || request === './db.js' || request === './db.ts') {
      const fake = require('./test_mock_db.js');
      return fake;
    }
  }
  return originalResolve.call(this, request, parent, isMain, options);
};
