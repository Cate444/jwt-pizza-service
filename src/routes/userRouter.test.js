const { app, request, randomName, expectValidJwt, createAdminUser, registerDiner, login } = require('../testHelpers');
const { DB } = require('../database/database.js');

let diner;
let dinerToken;

beforeEach(async () => {
  ({ user: diner, token: dinerToken } = await registerDiner());
});

test('get me', async () => {
  const res = await request(app).get('/api/user/me').set('Authorization', `Bearer ${dinerToken}`);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ id: diner.id, name: diner.name, email: diner.email, roles: [{ role: 'diner' }] });
});

test('get me without a token fails', async () => {
  const res = await request(app).get('/api/user/me');
  expect(res.status).toBe(401);
});

test('update own user', async () => {
  const newName = randomName();
  const newEmail = randomName() + '@test.com';
  const res = await request(app)
    .put(`/api/user/${diner.id}`)
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({ name: newName, email: newEmail, password: 'b' });
  expect(res.status).toBe(200);
  expect(res.body.user).toMatchObject({ id: diner.id, name: newName, email: newEmail });
  expectValidJwt(res.body.token);

  // The new password should work for logging in.
  const loginRes = await request(app).put('/api/auth').send({ email: newEmail, password: 'b' });
  expect(loginRes.status).toBe(200);
});

test('diner cannot update another user', async () => {
  const { user: other } = await registerDiner();
  const res = await request(app)
    .put(`/api/user/${other.id}`)
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({ name: 'hacked', email: other.email });
  expect(res.status).toBe(403);
});

test('admin can update another user', async () => {
  const adminToken = await login(await createAdminUser());
  const newName = randomName();
  const res = await request(app)
    .put(`/api/user/${diner.id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: newName, email: diner.email });
  expect(res.status).toBe(200);
  expect(res.body.user).toMatchObject({ id: diner.id, name: newName });
});

test('changing email to an existing email does not return the other user', async () => {
  const admin = await createAdminUser();
  const { user: attacker, token: attackerToken } = await registerDiner();
  const res = await request(app)
    .put(`/api/user/${attacker.id}`)
    .set('Authorization', `Bearer ${attackerToken}`)
    .send({ email: admin.email });
  expect(res.status).toBe(200);
  expect(res.body.user).toMatchObject({ id: attacker.id, roles: [{ role: 'diner' }] });

  // The returned token must still belong to the attacker, not the admin.
  const meRes = await request(app).get('/api/user/me').set('Authorization', `Bearer ${res.body.token}`);
  expect(meRes.body).toMatchObject({ id: attacker.id, roles: [{ role: 'diner' }] });
});

test('admin updating an unknown user gets 404', async () => {
  const adminToken = await login(await createAdminUser());
  const res = await request(app).put('/api/user/99999999').set('Authorization', `Bearer ${adminToken}`).send({ name: 'nobody' });
  expect(res.status).toBe(404);
});

test('diner cannot delete a user', async () => {
  const res = await request(app).delete(`/api/user/${diner.id}`).set('Authorization', `Bearer ${dinerToken}`);
  expect(res.status).toBe(403);
});

test('admin can delete a user', async () => {
  const adminToken = await login(await createAdminUser());
  const res = await request(app).delete(`/api/user/${diner.id}`).set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);

  // The deleted user's token no longer works and they can no longer log in.
  const meRes = await request(app).get('/api/user/me').set('Authorization', `Bearer ${dinerToken}`);
  expect(meRes.status).toBe(401);
  const loginRes = await request(app).put('/api/auth').send({ email: diner.email, password: diner.password });
  expect(loginRes.status).toBe(404);
});

test('admin deleting an unknown user gets 404', async () => {
  const adminToken = await login(await createAdminUser());
  const res = await request(app).delete('/api/user/99999999').set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(404);
});

test('failed delete rolls back and keeps the user', async () => {
  const adminToken = await login(await createAdminUser());
  const realQuery = DB.query.bind(DB);
  const spy = jest.spyOn(DB, 'query').mockImplementation((connection, sql, params) => {
    if (sql.startsWith('DELETE FROM user ')) {
      throw new Error('db failure');
    }
    return realQuery(connection, sql, params);
  });

  const res = await request(app).delete(`/api/user/${diner.id}`).set('Authorization', `Bearer ${adminToken}`);
  spy.mockRestore();
  expect(res.status).toBe(500);

  // The user's login was restored by the rollback, so their token still works.
  const meRes = await request(app).get('/api/user/me').set('Authorization', `Bearer ${dinerToken}`);
  expect(meRes.status).toBe(200);
});

test('delete user without a token fails', async () => {
  const res = await request(app).delete(`/api/user/${diner.id}`);
  expect(res.status).toBe(401);
});

test('update only the name keeps the email', async () => {
  const newName = randomName();
  const res = await request(app).put(`/api/user/${diner.id}`).set('Authorization', `Bearer ${dinerToken}`).send({ name: newName });
  expect(res.status).toBe(200);
  expect(res.body.user).toMatchObject({ id: diner.id, name: newName, email: diner.email });
});

test('update name with special characters is saved as-is', async () => {
  const res = await request(app)
    .put(`/api/user/${diner.id}`)
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({ name: "O'Brien", email: diner.email });
  expect(res.status).toBe(200);
  expect(res.body.user.name).toBe("O'Brien");
});

test('admin can list users filtered by name', async () => {
  const adminToken = await login(await createAdminUser());
  const res = await request(app).get(`/api/user?page=0&limit=10&name=${diner.name}`).set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.body.users).toEqual([{ id: diner.id, name: diner.name, email: diner.email, roles: [{ role: 'diner' }] }]);
  expect(res.body.more).toBe(false);
});

test('list users reports more pages', async () => {
  const adminToken = await login(await createAdminUser());
  const res = await request(app).get('/api/user?page=0&limit=1&name=*').set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.body.users.length).toBe(1);
  expect(res.body.more).toBe(true);
});

test('diner cannot list users', async () => {
  const res = await request(app).get('/api/user').set('Authorization', `Bearer ${dinerToken}`);
  expect(res.status).toBe(403);
});

test('list users without a token fails', async () => {
  const res = await request(app).get('/api/user');
  expect(res.status).toBe(401);
});
