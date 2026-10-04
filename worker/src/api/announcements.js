import {
  listActiveAnnouncements,
  listAllAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement
} from '../data/announcements.js';
import { errorResponse, parseJsonRequest } from '../utils.js';

export function registerAnnouncementRoutes(app) {
  // 获取当前生效的公告列表 (已登录用户)
  app.get('/api/announcements', async (c) => {
    try {
      const announcements = await listActiveAnnouncements(c.env.DB);
      return c.json({ announcements });
    } catch (error) {
      return errorResponse(error.message || '获取公告列表失败', 500);
    }
  });
}

export function registerAnnouncementAdminRoutes(app) {
  // 管理员获取全量公告 (含禁用/过期)
  app.get('/api/admin/announcements', async (c) => {
    try {
      const announcements = await listAllAnnouncements(c.env.DB);
      return c.json({ announcements });
    } catch (error) {
      return errorResponse(error.message || '获取公告列表失败', 500);
    }
  });

  // 管理员创建公告
  app.post('/api/admin/announcements', async (c) => {
    const session = c.get('session');
    if (!session?.userId) {
      return errorResponse('未授权', 401);
    }

    try {
      const body = await parseJsonRequest(c.req.raw);
      const announcement = await createAnnouncement(c.env.DB, {
        title: body.title,
        content: body.content,
        creatorId: session.userId,
        isPinned: body.isPinned !== false,
        isActive: body.isActive !== false,
        priority: body.priority || 0,
        startsAt: body.startsAt || null,
        expiresAt: body.expiresAt || null
      });
      return c.json({ announcement }, 201);
    } catch (error) {
      return errorResponse(error.message || '创建公告失败', 400);
    }
  });

  // 管理员更新公告
  app.put('/api/admin/announcements/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!id || Number.isNaN(id)) {
      return errorResponse('无效的公告 ID', 400);
    }

    try {
      const body = await parseJsonRequest(c.req.raw);
      const announcement = await updateAnnouncement(c.env.DB, id, {
        title: body.title,
        content: body.content,
        isPinned: body.isPinned,
        isActive: body.isActive,
        priority: body.priority,
        startsAt: body.startsAt,
        expiresAt: body.expiresAt
      });
      return c.json({ announcement });
    } catch (error) {
      return errorResponse(error.message || '更新公告失败', 400);
    }
  });

  // 管理员删除公告
  app.delete('/api/admin/announcements/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!id || Number.isNaN(id)) {
      return errorResponse('无效的公告 ID', 400);
    }

    try {
      await deleteAnnouncement(c.env.DB, id);
      return c.json({ ok: true });
    } catch (error) {
      return errorResponse(error.message || '删除公告失败', 400);
    }
  });
}
