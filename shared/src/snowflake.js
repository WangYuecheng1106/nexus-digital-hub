// 雪花 ID：41bit 时间戳 + 10bit 机器位 + 12bit 序列，BigInt 实现避免精度丢失。
// 消息等高频实体需要全局唯一且趋势递增的 ID，以保证按 ID 排序即按时间排序。
const EPOCH = 1704067200000n; // 2024-01-01
let workerId = BigInt((process.env.WORKER_ID || process.pid % 1024) & 1023);
let seq = 0n;
let lastTs = 0n;

export function snowflake() {
  let ts = BigInt(Date.now());
  if (ts === lastTs) {
    seq = (seq + 1n) & 4095n;
    if (seq === 0n) {
      while (ts <= lastTs) ts = BigInt(Date.now());
    }
  } else {
    seq = 0n;
  }
  lastTs = ts;
  return (((ts - EPOCH) << 22n) | (workerId << 12n) | seq).toString();
}
