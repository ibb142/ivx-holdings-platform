import { SUCCESS_VERIFICATION } from './ivx-senior-developer-smoke-test';

test('verifies the success constant', () => {
  expect(SUCCESS_VERIFICATION).toBe('IVX Senior Developer Smoke Test Successful');
});