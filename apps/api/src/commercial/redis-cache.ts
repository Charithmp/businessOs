import { createConnection } from 'node:net';

const encode = (parts: string[]) => `*${parts.length}\r\n${parts.map((part)=>`$${Buffer.byteLength(part)}\r\n${part}\r\n`).join('')}`;

export async function redisCommand(parts: string[]): Promise<string | null> {
  if (!process.env.REDIS_URL) return null;
  const url = new URL(process.env.REDIS_URL);
  if (url.protocol !== 'redis:') return null;
  return new Promise((resolve,reject) => {
    const socket = createConnection({ host:url.hostname,port:Number(url.port || 6379) });
    let buffer = Buffer.alloc(0);
    const timeout = setTimeout(()=>socket.destroy(new Error('Redis timeout')),1000);
    const finish = (error?: Error, value?: string | null) => {
      clearTimeout(timeout); socket.destroy();
      if (error) reject(error); else resolve(value ?? null);
    };
    socket.on('connect',()=>socket.write(encode(parts)));
    socket.on('error',(error)=>finish(error));
    socket.on('data',(chunk: Buffer) => {
      buffer = Buffer.concat([buffer,chunk]);
      const lineEnd = buffer.indexOf('\r\n');
      if (lineEnd < 0) return;
      const header = buffer.subarray(0,lineEnd).toString();
      if (header[0] === '+' || header[0] === ':') return finish(undefined,header.slice(1));
      if (header[0] === '-') return finish(new Error(header.slice(1)));
      if (header[0] !== '$') return finish(new Error('Unexpected Redis response'));
      const length = Number(header.slice(1));
      if (length === -1) return finish(undefined,null);
      if (buffer.length >= lineEnd+2+length+2) finish(undefined,buffer.subarray(lineEnd+2,lineEnd+2+length).toString());
    });
  });
}
