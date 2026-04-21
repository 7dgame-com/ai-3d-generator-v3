import fs from 'fs';
import path from 'path';

describe('direct-only backend surface', () => {
  it('keeps task routes auth-only for self-scoped resources', () => {
    const routeSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'routes', 'task.ts'),
      'utf8'
    );

    expect(routeSource).toContain("router.get('/', auth, listTasks);");
    expect(routeSource).toContain("router.get('/:taskId/download-url', auth, getDownloadUrl);");
    expect(routeSource).toContain("router.get('/:taskId', auth, getTask);");
    expect(routeSource).toContain("router.put('/:taskId/resource', auth, updateTaskResource);");
    expect(routeSource).not.toContain('requirePermission');
  });

  it('keeps direct task lifecycle routes auth-only', () => {
    const routeSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'routes', 'directTask.ts'),
      'utf8'
    );

    expect(routeSource).toContain("router.post('/prepare', auth, prepareTask);");
    expect(routeSource).toContain("router.post('/register', auth, registerTask);");
    expect(routeSource).toContain("router.post('/:taskId/complete', auth, completeTask);");
    expect(routeSource).toContain("router.post('/:taskId/fail', auth, failTask);");
    expect(routeSource).not.toContain('requirePermission');
  });

  it('keeps usage, download, and thumbnail routes auth-only', () => {
    const downloadRouteSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'routes', 'download.ts'),
      'utf8'
    );
    const thumbnailRouteSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'routes', 'thumbnail.ts'),
      'utf8'
    );
    const usageRouteSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'routes', 'usage.ts'),
      'utf8'
    );

    expect(downloadRouteSource).toContain("router.get('/:taskId', auth, (req, res) =>");
    expect(downloadRouteSource).not.toContain('requirePermission');
    expect(thumbnailRouteSource).toContain("router.get('/:taskId', auth, (req, res) =>");
    expect(thumbnailRouteSource).not.toContain('requirePermission');
    expect(usageRouteSource).toContain('auth,');
    expect(usageRouteSource).not.toContain('requirePermission');
  });

  it('does not mount the provider proxy route anymore', () => {
    const serverSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'index.ts'),
      'utf8'
    );

    expect(serverSource).not.toContain("import proxyRoutes from './routes/proxy';");
    expect(serverSource).not.toContain("app.use('/proxy', proxyRoutes);");
  });
});
