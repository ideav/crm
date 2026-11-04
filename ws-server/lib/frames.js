'use strict';
// Кадры WebSocket (RFC 6455) — ровно то, что нужно демону: рукопожатие, текст, бинарь,
// фрагменты, ping/pong/close. Клиент обязан маскировать кадры, сервер — нет.

const crypto = require('crypto');

const OP_CONT = 0x0, OP_TEXT = 0x1, OP_BINARY = 0x2, OP_CLOSE = 0x8, OP_PING = 0x9, OP_PONG = 0xA;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptKey(key) {
    return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

function encodeFrame(opcode, payload, masked = false, fin = true) {
    payload = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '');
    const len = payload.length;
    const ext = len < 126 ? 0 : len < 65536 ? 2 : 8;
    const head = Buffer.alloc(2 + ext + (masked ? 4 : 0));
    head[0] = (fin ? 0x80 : 0) | opcode;
    head[1] = (masked ? 0x80 : 0) | (ext === 0 ? len : ext === 2 ? 126 : 127);
    if (ext === 2) head.writeUInt16BE(len, 2);
    if (ext === 8) head.writeBigUInt64BE(BigInt(len), 2);
    if (!masked) return Buffer.concat([head, payload]);
    const mask = crypto.randomBytes(4);
    mask.copy(head, 2 + ext);
    const body = Buffer.from(payload);
    for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
    return Buffer.concat([head, body]);
}

// Поток байтов → готовые сообщения. Управляющие кадры отдаются сразу (и посреди фрагментов),
// фрагменты данных склеиваются в одно сообщение с опкодом первого кадра.
class FrameReader {
    constructor({ requireMask = true, maxPayload = 1 << 20 } = {}) {
        this.requireMask = requireMask;
        this.maxPayload = maxPayload;
        this.buf = Buffer.alloc(0);
        this.parts = null;
        this.partsOp = 0;
        this.partsLen = 0;
    }

    push(chunk) {
        this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
        const out = [];
        for (;;) {
            const frame = this.readFrame();
            if (!frame) break;
            const msg = this.assemble(frame);
            if (msg) out.push(msg);
        }
        return out;
    }

    readFrame() {
        const b = this.buf;
        if (b.length < 2) return null;
        const fin = (b[0] & 0x80) !== 0;
        if (b[0] & 0x70) throw new Error('reserved bits set');
        const opcode = b[0] & 0x0f;
        const masked = (b[1] & 0x80) !== 0;
        if (this.requireMask && !masked) throw new Error('client frame without mask');
        let len = b[1] & 0x7f;
        let off = 2;
        if (len === 126) {
            if (b.length < 4) return null;
            len = b.readUInt16BE(2); off = 4;
        } else if (len === 127) {
            if (b.length < 10) return null;
            const big = b.readBigUInt64BE(2);
            if (big > BigInt(this.maxPayload)) throw new Error('frame too large');
            len = Number(big); off = 10;
        }
        if (len > this.maxPayload) throw new Error('frame too large');
        if (opcode >= 0x8 && (len > 125 || !fin)) throw new Error('bad control frame');
        const maskOff = off;
        if (masked) off += 4;
        if (b.length < off + len) return null;
        const payload = Buffer.from(b.subarray(off, off + len));
        if (masked) for (let i = 0; i < len; i++) payload[i] ^= b[maskOff + (i & 3)];
        this.buf = b.subarray(off + len);
        return { fin, opcode, payload };
    }

    assemble(frame) {
        const { fin, opcode, payload } = frame;
        if (opcode >= 0x8) return { opcode, payload };
        if (opcode === OP_CONT) {
            if (!this.parts) throw new Error('continuation without start');
        } else {
            if (this.parts) throw new Error('new message inside fragmented one');
            if (opcode !== OP_TEXT && opcode !== OP_BINARY) throw new Error('unknown opcode ' + opcode);
            this.parts = []; this.partsOp = opcode; this.partsLen = 0;
        }
        this.partsLen += payload.length;
        if (this.partsLen > this.maxPayload) throw new Error('message too large');
        this.parts.push(payload);
        if (!fin) return null;
        const msg = { opcode: this.partsOp, payload: Buffer.concat(this.parts) };
        this.parts = null;
        return msg;
    }
}

module.exports = { acceptKey, encodeFrame, FrameReader, OP_CONT, OP_TEXT, OP_BINARY, OP_CLOSE, OP_PING, OP_PONG };
