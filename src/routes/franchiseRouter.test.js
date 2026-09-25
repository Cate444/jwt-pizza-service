const { app, request, randomName, createAdminUser, registerDiner, login } = require('../testHelpers');

let adminToken;
let franchisee;
let franchiseeToken;
let dinerToken;
let franchise;

async function createFranchise(adminEmail) {
  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: randomName(), admins: [{ email: adminEmail }] });
  return res.body;
}

beforeAll(async () => {
  adminToken = await login(await createAdminUser());
  ({ user: franchisee, token: franchiseeToken } = await registerDiner());
  ({ token: dinerToken } = await registerDiner());
  franchise = await createFranchise(franchisee.email);
});

test('admin can create a franchise', async () => {
  const name = randomName();
  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name, admins: [{ email: franchisee.email }] });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ name, admins: [{ email: franchisee.email, id: franchisee.id, name: franchisee.name }] });
  expect(res.body.id).toBeDefined();
});

test('diner cannot create a franchise', async () => {
  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({ name: randomName(), admins: [] });
  expect(res.status).toBe(403);
});

test('create franchise with unknown admin fails', async () => {
  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: randomName(), admins: [{ email: randomName() + '@nobody.com' }] });
  expect(res.status).toBe(404);
});

test('list franchises filtered by name', async () => {
  const res = await request(app).get(`/api/franchise?page=0&limit=10&name=${franchise.name}`);
  expect(res.status).toBe(200);
  expect(res.body.franchises).toEqual([expect.objectContaining({ id: franchise.id, name: franchise.name, stores: [] })]);
  expect(res.body.more).toBe(false);
});

test('admin sees franchise details in list', async () => {
  const res = await request(app).get(`/api/franchise?name=${franchise.name}`).set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.body.franchises[0].admins).toEqual([expect.objectContaining({ id: franchisee.id })]);
});

test('list franchises reports more pages', async () => {
  const res = await request(app).get('/api/franchise?page=0&limit=1&name=*');
  expect(res.status).toBe(200);
  expect(res.body.franchises.length).toBe(1);
  expect(res.body.more).toBe(true);
});

test('franchisee gets their franchises', async () => {
  const res = await request(app).get(`/api/franchise/${franchisee.id}`).set('Authorization', `Bearer ${franchiseeToken}`);
  expect(res.status).toBe(200);
  expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: franchise.id, name: franchise.name })]));
});

test('user with no franchises gets an empty list', async () => {
  const { user, token } = await registerDiner();
  const res = await request(app).get(`/api/franchise/${user.id}`).set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(res.body).toEqual([]);
});

test("diner cannot see another user's franchises", async () => {
  const res = await request(app).get(`/api/franchise/${franchisee.id}`).set('Authorization', `Bearer ${dinerToken}`);
  expect(res.status).toBe(200);
  expect(res.body).toEqual([]);
});

test('franchisee can create and delete a store', async () => {
  const createRes = await request(app)
    .post(`/api/franchise/${franchise.id}/store`)
    .set('Authorization', `Bearer ${franchiseeToken}`)
    .send({ name: 'SLC' });
  expect(createRes.status).toBe(200);
  expect(createRes.body).toMatchObject({ franchiseId: franchise.id, name: 'SLC' });

  const deleteRes = await request(app)
    .delete(`/api/franchise/${franchise.id}/store/${createRes.body.id}`)
    .set('Authorization', `Bearer ${franchiseeToken}`);
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body.message).toBe('store deleted');
});

test('diner cannot create a store', async () => {
  const res = await request(app).post(`/api/franchise/${franchise.id}/store`).set('Authorization', `Bearer ${dinerToken}`).send({ name: 'nope' });
  expect(res.status).toBe(403);
});

test('diner cannot delete a store', async () => {
  const createRes = await request(app).post(`/api/franchise/${franchise.id}/store`).set('Authorization', `Bearer ${adminToken}`).send({ name: 'Provo' });
  const res = await request(app).delete(`/api/franchise/${franchise.id}/store/${createRes.body.id}`).set('Authorization', `Bearer ${dinerToken}`);
  expect(res.status).toBe(403);
});

test('admin can delete a franchise', async () => {
  const toDelete = await createFranchise(franchisee.email);
  await request(app).post(`/api/franchise/${toDelete.id}/store`).set('Authorization', `Bearer ${adminToken}`).send({ name: 'Orem' });

  const res = await request(app).delete(`/api/franchise/${toDelete.id}`).set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('franchise deleted');

  const listRes = await request(app).get(`/api/franchise?name=${toDelete.name}`);
  expect(listRes.body.franchises).toEqual([]);
});

describe('known bugs', () => {
  test('diner cannot delete a franchise', async () => {
    const target = await createFranchise(franchisee.email);
    const res = await request(app).delete(`/api/franchise/${target.id}`).set('Authorization', `Bearer ${dinerToken}`);
    expect(res.status).toBe(403);
  });

  test('delete franchise without a token fails', async () => {
    const target = await createFranchise(franchisee.email);
    const res = await request(app).delete(`/api/franchise/${target.id}`);
    expect(res.status).toBe(401);
  });
});
