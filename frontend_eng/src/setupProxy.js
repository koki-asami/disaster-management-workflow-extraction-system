const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  console.log('Setting up proxy middleware');
  app.use(
    ['/analyze_pdf', '/chat_update', '/health'],
    createProxyMiddleware({
      target: 'http://localhost:8081',
      changeOrigin: true,
      logLevel: 'debug',
      pathRewrite: {
        '^/analyze_pdf': '/analyze_pdf',
        '^/chat_update': '/chat_update',
        '^/health': '/health'
      },
      onProxyReq: (proxyReq, req, res) => {
        console.log('Proxying request:', req.method, req.path);
      },
      onError: (err, req, res) => {
        console.error('Proxy error:', err);
        res.writeHead(500, {
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify({ error: 'Proxy error: ' + err.message }));
      }
    })
  );
};