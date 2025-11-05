// policy_worker.js — 純 JS base64 + UTF-8 解碼，長駐 stdin/stdout
import * as std from 'std';

// ---- base64 -> bytes (純 JS，不依賴 std/atob/TextDecoder) ----
const _b64abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const _lut = (()=>{
  const t = new Int16Array(256);
  for (let i = 0; i < t.length; i++) t[i] = -1;
  for (let i = 0; i < _b64abc.length; i++) t[_b64abc.charCodeAt(i)] = i;
  return t;
})();
function b64ToBytes(b64) {
  const s = b64.replace(/[\r\n\s]/g, "");
  const len = s.length;
  let pads = 0;
  if (len >= 2) {
    if (s[len - 1] === '=') pads++;
    if (s[len - 2] === '=') pads++;
  }
  const out = new Uint8Array(((len * 3) >> 2) - pads);
  let oi = 0, i = 0;
  while (i < len) {
    const c1 = _lut[s.charCodeAt(i++)]; const c2 = _lut[s.charCodeAt(i++)];
    const c3 = i < len ? _lut[s.charCodeAt(i++)] : -1;
    const c4 = i < len ? _lut[s.charCodeAt(i++)] : -1;
    const b1 = (c1 << 2) | (c2 >> 4);
    out[oi++] = b1 & 0xFF;
    if (c3 >= 0) {
      const b2 = ((c2 & 0x0F) << 4) | (c3 >> 2);
      if (oi < out.length) out[oi++] = b2 & 0xFF;
      if (c4 >= 0) {
        const b3 = ((c3 & 0x03) << 6) | c4;
        if (oi < out.length) out[oi++] = b3 & 0xFF;
      }
    }
  }
  return out;
}

// ---- UTF-8 bytes -> JS string（不靠 TextDecoder）----
function utf8BytesToString(u8) {
  let out = "", i = 0;
  while (i < u8.length) {
    const c = u8[i++];
    if (c < 0x80) {
      out += String.fromCharCode(c);
    } else if (c < 0xE0) {
      const c2 = u8[i++];
      out += String.fromCharCode(((c & 0x1F) << 6) | (c2 & 0x3F));
    } else if (c < 0xF0) {
      const c2 = u8[i++], c3 = u8[i++];
      out += String.fromCharCode(((c & 0x0F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F));
    } else {
      const c2 = u8[i++], c3 = u8[i++], c4 = u8[i++];
      let cp = ((c & 0x07) << 18) | ((c2 & 0x3F) << 12) | ((c3 & 0x3F) << 6) | (c4 & 0x3F);
      cp -= 0x10000;
      out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
    }
  }
  return out;
}

function b64ToUtf8String(b64) {
  return utf8BytesToString(b64ToBytes(b64));
}

// ---- 把 script 字串變成可呼叫的函式 ----
function buildValidator(scriptRaw) {
  const s = scriptRaw.trim();

  // 1) 當函式/箭頭包起來
  try {
    const v1 = eval(`(${s})`);
    if (typeof v1 === 'function') return v1;
  } catch (e) {}

  // 2) 直接 eval（有些人會傳 "function(m){...}"）
  try {
    const v2 = eval(s);
    if (typeof v2 === 'function') return v2;
  } catch (e) {}

  // 3) 當表達式包成函式體（例如 "m && m.a===1"）
  try {
    const v3 = new Function('m', `return (${s});`);
    if (typeof v3 === 'function') return v3;
  } catch (e) {}

  return null;
}

// ---- 主循環：每行一筆請求 ----
const DEBUG = std.getenv('DEBUG') === '1';
while (true) {
  const line = std.in.getline();
  if (line === null) break; // EOF

  let ok = false;
  try {
    const msg = JSON.parse(line);
    const para = msg.para || null;
    const scriptStr = b64ToUtf8String(msg.script_b64);
    const modelStr  = b64ToUtf8String(msg.model_b64);
    const model = JSON.parse(modelStr);

    const fn = buildValidator(scriptStr);
    if (DEBUG) {
      std.err.puts(`script.len=${scriptStr.length} fn_is_func=${typeof fn === 'function'}\n`);
      std.err.puts(`model.len=${modelStr.length}\n`);
    }

    if (typeof fn === 'function' && para) {ok = !!fn(model, para);}
    else if (typeof fn === 'function') ok = !!fn(model);

  } catch (e) {
    if (DEBUG) std.err.puts(`ERR: ${e}\n`);
    ok = false;
  }

  std.out.puts(ok ? '1\n' : '0\n');
  std.out.flush();
}
