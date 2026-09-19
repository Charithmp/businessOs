import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports service health', () => expect(new HealthController().check()).toEqual({ status: 'ok' }));
});
