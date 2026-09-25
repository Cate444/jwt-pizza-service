const { app, request, randomName, createAdminUser, registerDiner, login } = require('../testHelpers');

let adminToken;
let dinerToken;
let menuItem;

beforeAll(async () => {
  adminToken = await login(await createAdminUser());
  ({ token: dinerToken } = await registerDiner());

  const item = { title: randomName(), description: 'test pizza', image: 'pizza1.png', price: 0.001 };
  const res = await request(app).put('/api/order/menu').set('Authorization', `Bearer ${adminToken}`).send(item);
  menuItem = res.body.find((m) => m.title === item.title);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('get menu', async () => {
  const res = await request(app).get('/api/order/menu');
  expect(res.status).toBe(200);
  expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: menuItem.id, title: menuItem.title })]));
});

test('admin can add a menu item', async () => {
  const item = { title: randomName(), description: 'another pizza', image: 'pizza2.png', price: 0.002 };
  const res = await request(app).put('/api/order/menu').set('Authorization', `Bearer ${adminToken}`).send(item);
  expect(res.status).toBe(200);
  expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining(item)]));
});

test('diner cannot add a menu item', async () => {
  const item = { title: randomName(), description: 'nope', image: 'pizza3.png', price: 0.003 };
  const res = await request(app).put('/api/order/menu').set('Authorization', `Bearer ${dinerToken}`).send(item);
  expect(res.status).toBe(403);
});

test('create order and get orders', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ reportUrl: 'http://report', jwt: 'factory.jwt.token' }),
  });

  const order = { franchiseId: 1, storeId: 1, items: [{ menuId: menuItem.id, description: menuItem.description, price: menuItem.price }] };
  const createRes = await request(app).post('/api/order').set('Authorization', `Bearer ${dinerToken}`).send(order);
  expect(createRes.status).toBe(200);
  expect(createRes.body.order).toMatchObject(order);
  expect(createRes.body.jwt).toBe('factory.jwt.token');
  expect(global.fetch).toHaveBeenCalledTimes(1);

  const getRes = await request(app).get('/api/order').set('Authorization', `Bearer ${dinerToken}`);
  expect(getRes.status).toBe(200);
  expect(getRes.body.orders).toEqual(expect.arrayContaining([expect.objectContaining({ id: createRes.body.order.id })]));
});

test('create order when factory fails', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: false,
    json: async () => ({ reportUrl: 'http://report' }),
  });

  const order = { franchiseId: 1, storeId: 1, items: [{ menuId: menuItem.id, description: menuItem.description, price: menuItem.price }] };
  const res = await request(app).post('/api/order').set('Authorization', `Bearer ${dinerToken}`).send(order);
  expect(res.status).toBe(500);
  expect(res.body.message).toBe('Failed to fulfill order at factory');
});

test('create order without a token fails', async () => {
  const res = await request(app).post('/api/order').send({});
  expect(res.status).toBe(401);
});
