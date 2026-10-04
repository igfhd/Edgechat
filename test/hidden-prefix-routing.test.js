import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getBasePrefix } from '../frontend/src/api.js';

function getRouterBase() {
  if (typeof global.window === 'undefined') return '/';
  const pathname = global.window.location.pathname;
  const firstSeg = pathname.split('/').filter(Boolean)[0] || '';
  const standardRoutes = ['login', 'register', 'admin', 'settings', 'drive', 's', 'api', 'files', 'dav'];
  if (firstSeg && !standardRoutes.includes(firstSeg)) {
    return `/${firstSeg}/`;
  }
  return '/';
}

describe('隐藏入口路径与 WebDAV/外链路由适配测试 (Hidden Route Prefix Adaptations)', () => {
  it('在无隐藏入口路径时返回根路径', () => {
    global.window = {
      location: {
        origin: 'https://chat.example.com',
        pathname: '/settings'
      }
    };

    assert.equal(getBasePrefix(), '');
    assert.equal(getRouterBase(), '/');

    delete global.window;
  });

  it('在配置了自定义隐藏入口路径时能够自动提取并注入前缀', () => {
    global.window = {
      location: {
        origin: 'https://chat.example.com',
        pathname: '/secret_entry_xyz/settings'
      }
    };

    assert.equal(getBasePrefix(), '/secret_entry_xyz');
    assert.equal(getRouterBase(), '/secret_entry_xyz/');

    // Simulate WebDAV URL construction
    const origin = global.window.location.origin;
    const prefix = getBasePrefix();
    const webdavEndpoint = `${origin}${prefix}/dav/`;
    const webdavPath = `${prefix}/dav/`;

    assert.equal(webdavEndpoint, 'https://chat.example.com/secret_entry_xyz/dav/');
    assert.equal(webdavPath, '/secret_entry_xyz/dav/');

    delete global.window;
  });

  it('支持使用任意一个不同的隐藏入口进入主项目并自适应路由', () => {
    const entrances = ['secret_a', 'portal_b', 'vip_team_99'];

    for (const entrance of entrances) {
      global.window = {
        location: {
          origin: 'https://chat.example.com',
          pathname: `/${entrance}/admin/site`
        }
      };

      assert.equal(getBasePrefix(), `/${entrance}`);
      assert.equal(getRouterBase(), `/${entrance}/`);
    }

    delete global.window;
  });

  it('标准系统路由不应被误判为隐藏前缀', () => {
    const standardPaths = [
      '/login',
      '/register/token123',
      '/admin/dashboard',
      '/settings',
      '/drive',
      '/s/sharetoken456',
      '/api/drive/files',
      '/files/doc.pdf',
      '/dav/'
    ];

    for (const p of standardPaths) {
      global.window = {
        location: {
          origin: 'https://chat.example.com',
          pathname: p
        }
      };

      assert.equal(getBasePrefix(), '', `路径 ${p} 不应提取出前缀`);
      assert.equal(getRouterBase(), '/', `路径 ${p} 的 Router Base 应为 /`);
    }

    delete global.window;
  });
});
