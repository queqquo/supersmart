import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveWriteStatus } from './archive-access.mjs';
import draws from '../api/draws.js';

const googleIdentity = { email_verified: true, firebase: { sign_in_provider: 'google.com' } };
const mockBearer = 'Bearer one.two.three';

test('archive rejects absent or malformed credentials before calling a verifier', async () => {
  const unexpected = () => assert.fail('verification should not run');
  for (const value of [undefined, 'Bearer access-token', 'Basic one.two.three']) {
    assert.equal(await archiveWriteStatus(value, { verifyToken: unexpected }), 401);
  }
});

test('archive requires verified Google identity and an explicit policy allow', async () => {
  const failedIdentity = () => assert.fail('policy should not run');
  assert.equal(await archiveWriteStatus(mockBearer, {
    verifyToken: async () => { throw new Error(); }, fetchPolicy: failedIdentity,
  }), 401);
  assert.equal(await archiveWriteStatus(mockBearer, {
    verifyToken: async () => ({ ...googleIdentity, email_verified: false }), fetchPolicy: failedIdentity,
  }), 403);
  for (const [policy, expected] of [[403, 403], [200, 200], [500, 503]]) {
    assert.equal(await archiveWriteStatus(mockBearer, {
      verifyToken: async () => googleIdentity,
      fetchPolicy: async (url, options) => {
        assert.equal(new URL(url).hostname, 'firestore.googleapis.com');
        assert.equal(options.headers.Authorization, mockBearer);
        return new Response(null, { status: policy });
      },
    }), expected);
  }
});

test('draw mutation handler fails closed before any upstream write for anonymous clients', async () => {
  const res = {
    setHeader() {}, status(value) { this.code = value; return this; }, json(body) { this.body = body; },
  };
  for (const method of ['POST', 'PUT']) {
    await draws({ method, headers: {} }, res);
    assert.equal(res.code, 401);
    assert.equal(res.body.ok, false);
  }
});
