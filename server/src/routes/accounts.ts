import Router from 'koa-router';
import { AccountController } from '../controllers/AccountController';

export const accountRoutes = new Router();
const ctrl = new AccountController();

accountRoutes.get('/', ctrl.list);
accountRoutes.get('/providers', ctrl.providers);
accountRoutes.post('/', ctrl.create);
accountRoutes.post('/batch-delete', ctrl.batchDelete);
accountRoutes.post('/import', ctrl.import);
accountRoutes.post('/import-preview', ctrl.importPreview);
accountRoutes.post('/import-confirm', ctrl.importConfirm);
accountRoutes.post('/export', ctrl.export);
accountRoutes.post('/refresh-tokens', ctrl.refreshTokens);
accountRoutes.put('/:id', ctrl.update);
accountRoutes.delete('/:id', ctrl.delete);
accountRoutes.post('/:id/tags', ctrl.setTags);
accountRoutes.post('/:id/refresh-token', ctrl.refreshToken);
