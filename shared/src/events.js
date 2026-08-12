// 跨服务事件总线：通过 gateway 做 HTTP 扇出。服务启动时向 gateway 注册订阅，
// 发布时 POST 到 gateway 由其转发给所有订阅者。轻量替代 Kafka/RabbitMQ——
// 本地单机构建期无需消息队列基础设施，接口语义保持"发布/订阅"以便日后替换。
const GATEWAY = process.env.NEXUS_GATEWAY_URL || 'http://localhost:8080';
const INTERNAL_TOKEN = process.env.NEXUS_INTERNAL_TOKEN || 'nexus-internal-dev-token';

export async function publishEvent(type, payload = {}, source = 'unknown') {
  try {
    const res = await fetch(`${GATEWAY}/internal/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': INTERNAL_TOKEN },
      body: JSON.stringify({ type, payload, source }),
    });
    return res.ok;
  } catch {
    return false; // 事件投递失败不阻断主流程，由消息中心做兜底轮询
  }
}

export async function subscribeEvents(name, port, types = ['*']) {
  try {
    await fetch(`${GATEWAY}/internal/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': INTERNAL_TOKEN },
      body: JSON.stringify({ service: name, url: `http://localhost:${port}/internal/events`, types }),
    });
  } catch { /* gateway 未就绪时忽略，依赖心跳重注册 */ }
}
