// WebSocket 基础设施：心跳保活（30s）、令牌鉴权、按用户分组的连接注册表。
import { WebSocketServer } from 'ws';
import { verifyToken } from './jwt.js';

export function createWsHub({ server, path = '/ws', onMessage, onConnect, onDisconnect }) {
  const wss = new WebSocketServer({ server, path });
  // userId -> Set<socket>
  const users = new Map();
  const stats = { connections: 0, messages: 0 };

  wss.on('connection', (socket, req) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token') || (req.headers.authorization || '').replace('Bearer ', '');
      const user = verifyToken(token);
      socket.userId = String(user.sub);
      socket.user = user;
      socket.isAlive = true;
    } catch {
      socket.send(JSON.stringify({ type: 'error', message: 'ws_auth_failed' }));
      return socket.close(4001, 'unauthorized');
    }

    const uid = socket.userId;
    if (!users.has(uid)) users.set(uid, new Set());
    users.get(uid).add(socket);
    stats.connections++;

    socket.on('pong', () => (socket.isAlive = true));
    socket.on('message', (data) => {
      stats.messages++;
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return socket.send(JSON.stringify({ type: 'error', message: 'invalid_json' }));
      }
      Promise.resolve(onMessage?.(socket, msg, hub)).catch((e) =>
        socket.send(JSON.stringify({ type: 'error', message: e.message }))
      );
    });
    socket.on('close', () => {
      users.get(uid)?.delete(socket);
      if (users.get(uid)?.size === 0) users.delete(uid);
      onDisconnect?.(socket, hub);
    });
    onConnect?.(socket, hub);
  });

  // 心跳：30 秒未响应的连接判定死亡并断开，防止半开连接占用资源
  const interval = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, 30000);
  wss.on('close', () => clearInterval(interval));

  const hub = {
    wss,
    onlineUserIds: () => [...users.keys()],
    onlineCount: () => users.size,
    stats: () => ({ ...stats, online: users.size }),
    sendTo(userIds, message) {
      const data = JSON.stringify(message);
      let delivered = 0;
      for (const uid of Array.isArray(userIds) ? userIds : [userIds]) {
        for (const socket of users.get(String(uid)) || []) {
          if (socket.readyState === 1) {
            socket.send(data);
            delivered++;
          }
        }
      }
      return delivered;
    },
    broadcast(message) {
      const data = JSON.stringify(message);
      for (const socket of wss.clients) if (socket.readyState === 1) socket.send(data);
    },
    isOnline: (uid) => users.has(String(uid)),
  };
  return hub;
}
