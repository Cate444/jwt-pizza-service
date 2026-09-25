const { app, request, expectValidJwt, registerDiner } = require('../testHelpers');

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);
});

test('login', async () => {
  const loginRes = await request(app).put('/api/auth').send(testUser);
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);

  const expectedUser = { ...testUser, roles: [{ role: 'diner' }] };
  delete expectedUser.password;
  expect(loginRes.body.user).toMatchObject(expectedUser);
});

test('register without all fields fails', async () => {
  const res = await request(app).post('/api/auth').send({ name: 'no email' });
  expect(res.status).toBe(400);
  expect(res.body.message).toBe('name, email, and password are required');
});

test('login with wrong password fails', async () => {
  const res = await request(app).put('/api/auth').send({ email: testUser.email, password: 'wrong' });
  expect(res.status).toBe(404);
  expect(res.body.message).toBe('unknown user');
});

test('logout', async () => {
  const { token } = await registerDiner();

  const logoutRes = await request(app).delete('/api/auth').set('Authorization', `Bearer ${token}`);
  expect(logoutRes.status).toBe(200);
  expect(logoutRes.body.message).toBe('logout successful');

  // The token should no longer work after logging out.
  const meRes = await request(app).get('/api/user/me').set('Authorization', `Bearer ${token}`);
  expect(meRes.status).toBe(401);
});

test('logout without a token fails', async () => {
  const res = await request(app).delete('/api/auth');
  expect(res.status).toBe(401);
});

test('invalid token is ignored', async () => {
  const res = await request(app).get('/api/user/me').set('Authorization', 'Bearer not.a.token');
  expect(res.status).toBe(401);
});
