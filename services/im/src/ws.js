// nexus-im：WebSocket 消息处理
import { db, createMessage, deliverMessage, getConversationMembers } from './repo.js';

export function handleWsMessage(hub) {
  return async (socket, msg) => {
    switch (msg.type) {
      case 'im:send': {
        const m = createMessage(msg.conversationId, socket.userId, msg.messageType, msg.body);
        deliverMessage(hub, m);
        socket.send(JSON.stringify({ type: 'im:ack', messageId: m.id, conversationId: msg.conversationId }));
        break;
      }
      case 'im:read': {
        db.run('UPDATE conversation_members SET last_read_msg_id = ? WHERE conversation_id = ? AND user_id = ?',
          msg.lastReadMsgId, msg.conversationId, socket.userId);
        const conv = db.get('SELECT * FROM conversations WHERE id = ?', msg.conversationId);
        if (conv?.type === 'single') {
          const other = db.get('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?',
            msg.conversationId, socket.userId);
          if (other) hub.sendTo(other.user_id, { type: 'im:read', conversationId: msg.conversationId, userId: socket.userId, lastReadMsgId: msg.lastReadMsgId });
        }
        break;
      }
      case 'im:typing': {
        const members = getConversationMembers(msg.conversationId).filter((u) => u !== socket.userId);
        hub.sendTo(members, { type: 'im:typing', conversationId: msg.conversationId, userId: socket.userId });
        break;
      }
      case 'im:recall': {
        const m = db.get('SELECT * FROM messages WHERE id = ?', msg.messageId);
        if (m && m.sender_id === socket.userId && Date.now() - m.created_at < 120000) {
          db.run('UPDATE messages SET status = ?, updated_at = ? WHERE id = ?', 'recalled', Date.now(), m.id);
          const members = getConversationMembers(m.conversation_id);
          hub.sendTo(members, { type: 'im:recall', messageId: m.id, conversationId: m.conversation_id, senderId: socket.userId });
        }
        break;
      }
      case 'im:ping':
        socket.send(JSON.stringify({ type: 'im:pong', t: Date.now() }));
        break;
    }
  };
}
