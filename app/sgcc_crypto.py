import base64
import binascii
import random
import urllib.parse
from math import ceil


def str_to_bytes(input_str):
    out = []
    for char in input_str:
        quoted = urllib.parse.quote(char)
        if len(quoted) == 1:
            out.append(ord(char))
        else:
            for item in quoted.split("%")[1:]:
                out.append(int("0x" + item, 16))
    return out


def bytes_to_hex(bytes_input):
    text = ""
    for item in bytes_input:
        value = hex(item)[2:]
        if len(value) == 1:
            value = "0" + value
        text += value
    return text


def string_to_hex(value):
    return "" if value == "" else bytes_to_hex(str_to_bytes(value))


xor = lambda a, b: list(map(lambda x, y: x ^ y, a, b))
rotl = lambda x, n: x << n & 4294967295 | x >> 32 - n & 4294967295
get_uint32_be = lambda key_data: key_data[0] << 24 | key_data[1] << 16 | key_data[2] << 8 | key_data[3]
put_uint32_be = lambda n: [n >> 24 & 255, n >> 16 & 255, n >> 8 & 255, n & 255]
pkcs7_padding = lambda data, block=16: data + [16 - len(data) % block for _ in range(16 - len(data) % block)]
pkcs7_unpadding = lambda data: data[:-data[-1]]
list_to_bytes = lambda data: b"".join([bytes((item,)) for item in data])
bytes_to_list = lambda data: [item for item in data]
random_hex = lambda x: "".join([random.choice("0123456789abcdef") for _ in range(x)])


IV = [1937774191, 1226093241, 388252375, 3666478592, 2842636476, 372324522, 3817729613, 2969243214]
T_J = [
    *([2043430169] * 16),
    *([2055708042] * 48),
]


def m_ff_j(x, y, z, j):
    if 0 <= j < 16:
        return x ^ y ^ z
    return x & y | x & z | y & z


def m_gg_j(x, y, z, j):
    if 0 <= j < 16:
        return x ^ y ^ z
    return x & y | ~x & z


def m_p_0(x):
    return x ^ rotl(x, 9 % 32) ^ rotl(x, 17 % 32)


def m_p_1(x):
    return x ^ rotl(x, 15 % 32) ^ rotl(x, 23 % 32)


def m_cf(v_i, b_i):
    words = []
    for n in range(16):
        factor = 16777216
        word = 0
        for p in range(n * 4, (n + 1) * 4):
            word += b_i[p] * factor
            factor = int(factor / 256)
        words.append(word)
    for i in range(16, 68):
        words.append(0)
        words[i] = m_p_1(words[i - 16] ^ words[i - 9] ^ rotl(words[i - 3], 15 % 32)) ^ rotl(words[i - 13], 7 % 32) ^ words[i - 6]
    mixed = []
    for i in range(64):
        mixed.append(words[i] ^ words[i + 4])
    a, b, c, d, e, f, g, h = v_i
    for i in range(64):
        ss1 = rotl((rotl(a, 12 % 32) + e + rotl(T_J[i], i % 32)) & 4294967295, 7 % 32)
        ss2 = ss1 ^ rotl(a, 12 % 32)
        tt1 = (m_ff_j(a, b, c, i) + d + ss2 + mixed[i]) & 4294967295
        tt2 = (m_gg_j(e, f, g, i) + h + ss1 + words[i]) & 4294967295
        d = c
        c = rotl(b, 9 % 32)
        b = a
        a = tt1
        h = g
        g = rotl(f, 19 % 32)
        f = e
        e = m_p_0(tt2)
        a, b, c, d, e, f, g, h = map(lambda x: x & 4294967295, [a, b, c, d, e, f, g, h])
    result = [a, b, c, d, e, f, g, h]
    return [result[i] ^ v_i[i] for i in range(8)]


def sm3_hash(msg):
    data = msg
    length = len(data)
    remainder = length % 64
    data.append(128)
    remainder += 1
    target = 56
    if remainder > target:
        target += 64
    for _ in range(remainder, target):
        data.append(0)
    bit_length = length * 8
    tail = [bit_length % 256]
    for _ in range(7):
        bit_length = int(bit_length / 256)
        tail.append(bit_length % 256)
    for i in range(8):
        data.append(tail[7 - i])
    blocks = round(len(data) / 64)
    grouped = []
    for i in range(blocks):
        grouped.append(data[i * 64 : (i + 1) * 64])
    vectors = [IV]
    for i in range(blocks):
        vectors.append(m_cf(vectors[i], grouped[i]))
    last = vectors[-1]
    text = ""
    for item in last:
        text = "%s%08x" % (text, item)
    return text


def sm3_kdf(z, klen):
    klen = int(klen)
    ct = 1
    rounds = ceil(klen / 32)
    source = [item for item in bytes.fromhex(z.decode("utf8"))]
    result = ""
    for _ in range(rounds):
        payload = source + [item for item in binascii.a2b_hex(("%08x" % ct).encode("utf8"))]
        result += sm3_hash(payload)
        ct += 1
    return result[0 : klen * 2]


DEFAULT_ECC_TABLE = {
    "n": "FFFFFFFEFFFFFFFFFFFFFFFFFFFFFFFF7203DF6B21C6052B53BBF40939D54123",
    "p": "FFFFFFFEFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00000000FFFFFFFFFFFFFFFF",
    "g": "32c4ae2c1f1981195f9904466a39c9948fe30bbff2660be1715a4589334c74c7bc3736a2f4f6779c59bdcee36b692153d0a9877cc62a474002df32e52139f0a0",
    "a": "FFFFFFFEFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00000000FFFFFFFFFFFFFFFC",
    "b": "28E9FA9E9D9F5E344D5A9E4BCF6509A7F39789F515AB8F92DDBCBD414D940E93",
}


class Sm2Crypt:
    def __init__(self, public_key, ecc_table=DEFAULT_ECC_TABLE, mode=1):
        self.public_key = public_key[2:] if public_key.startswith("04") and len(public_key) == 130 else public_key
        self.para_len = len(ecc_table["n"])
        self.ecc_a3 = (int(ecc_table["a"], 16) + 3) % int(ecc_table["p"], 16)
        self.ecc_table = ecc_table
        self.mode = mode

    def _kg(self, k, point):
        point = "%s%s" % (point, "1")
        mask = int("8" + ("0" * (self.para_len - 1)), 16)
        result = point
        flag = False
        for _ in range(self.para_len * 4):
            if flag:
                result = self._double_point(result)
            if k & mask != 0:
                if flag:
                    result = self._add_point(result, point)
                else:
                    flag = True
                    result = point
            k = k << 1
        return self._convert_jacb_to_nor(result)

    def _double_point(self, point):
        length = len(point)
        double_len = 2 * self.para_len
        if length < self.para_len * 2:
            return None
        x1 = int(point[0:self.para_len], 16)
        y1 = int(point[self.para_len:double_len], 16)
        z1 = 1 if length == double_len else int(point[double_len:], 16)
        p = int(self.ecc_table["p"], 16)
        t6 = z1 * z1 % p
        t2 = y1 * y1 % p
        t3 = (x1 + t6) % p
        t4 = (x1 - t6) % p
        t1 = t3 * t4 % p
        t3 = y1 * z1 % p
        t4 = t2 * 8 % p
        t5 = x1 * t4 % p
        t1 = t1 * 3 % p
        t6 = t6 * t6 % p
        t6 = self.ecc_a3 * t6 % p
        t1 = (t1 + t6) % p
        z3 = (t3 + t3) % p
        t3 = t1 * t1 % p
        t2 = t2 * t4 % p
        x3 = (t3 - t5) % p
        if t5 % 2 == 1:
            t4 = (t5 + ((t5 + p) >> 1) - t3) % p
        else:
            t4 = (t5 + (t5 >> 1) - t3) % p
        t1 = t1 * t4 % p
        y3 = (t1 - t2) % p
        return ("%0" + str(self.para_len) + "x") * 3 % (x3, y3, z3)

    def _add_point(self, p1, p2):
        double_len = 2 * self.para_len
        if len(p1) < double_len or len(p2) < double_len:
            return None
        x1 = int(p1[0:self.para_len], 16)
        y1 = int(p1[self.para_len:double_len], 16)
        z1 = 1 if len(p1) == double_len else int(p1[double_len:], 16)
        x2 = int(p2[0:self.para_len], 16)
        y2 = int(p2[self.para_len:double_len], 16)
        p = int(self.ecc_table["p"], 16)
        t1 = z1 * z1 % p
        t2 = y2 * z1 % p
        t3 = x2 * t1 % p
        t1 = t1 * t2 % p
        t2 = (t3 - x1) % p
        t3 = (t3 + x1) % p
        t4 = t2 * t2 % p
        t1 = (t1 - y1) % p
        z3 = z1 * t2 % p
        t2 = t2 * t4 % p
        t3 = t3 * t4 % p
        t5 = t1 * t1 % p
        t4 = x1 * t4 % p
        x3 = (t5 - t3) % p
        t2 = y1 * t2 % p
        t3 = (t4 - x3) % p
        t1 = t1 * t3 % p
        y3 = (t1 - t2) % p
        return ("%0" + str(self.para_len) + "x") * 3 % (x3, y3, z3)

    def _convert_jacb_to_nor(self, point):
        double_len = 2 * self.para_len
        x = int(point[0:self.para_len], 16)
        y = int(point[self.para_len:double_len], 16)
        z = int(point[double_len:], 16)
        p = int(self.ecc_table["p"], 16)
        z_inv = pow(z, p - 2, p)
        z_inv2 = z_inv * z_inv % p
        z_inv3 = z_inv2 * z_inv % p
        x3 = x * z_inv2 % p
        y3 = y * z_inv3 % p
        if z * z_inv % p == 1:
            return ("%0" + str(self.para_len) + "x") * 2 % (x3, y3)
        return None

    def encrypt(self, data):
        msg = data.hex()
        k = random_hex(self.para_len)
        c1 = self._kg(int(k, 16), self.ecc_table["g"])
        xy = self._kg(int(k, 16), self.public_key)
        x2 = xy[0:self.para_len]
        y2 = xy[self.para_len:2 * self.para_len]
        ml = len(msg)
        t = sm3_kdf(xy.encode("utf8"), ml / 2)
        if int(t, 16) == 0:
            return None
        fmt = "%0" + str(ml) + "x"
        c2 = fmt % (int(msg, 16) ^ int(t, 16))
        c3 = sm3_hash([item for item in bytes.fromhex("%s%s%s" % (x2, msg, y2))])
        if self.mode:
            return bytes.fromhex("%s%s%s" % (c1, c3, c2))
        return bytes.fromhex("%s%s%s" % (c1, c2, c3))


SM4_BOXES_TABLE = [
    214,144,233,254,204,225,61,183,22,182,20,194,40,251,44,5,43,103,154,118,42,190,4,195,170,68,19,38,73,134,6,153,
    156,66,80,244,145,239,152,122,51,84,11,67,237,207,172,98,228,179,28,169,201,8,232,149,128,223,148,250,117,143,
    63,166,71,7,167,252,243,115,23,186,131,89,60,25,230,133,79,168,104,107,129,178,113,100,218,139,248,235,15,75,
    112,86,157,53,30,36,14,94,99,88,209,162,37,34,124,59,1,33,120,135,212,0,70,87,159,211,39,82,76,54,2,231,
    160,196,200,158,234,191,138,210,64,199,56,181,163,247,242,206,249,97,21,161,224,174,93,164,155,52,26,85,173,147,
    50,48,245,140,177,227,29,246,226,46,130,102,202,96,192,41,35,171,13,83,78,111,213,219,55,69,222,253,142,47,
    3,255,106,114,109,108,91,81,141,27,175,146,187,221,188,127,17,217,92,65,31,16,90,216,10,193,49,136,165,205,
    123,189,45,116,208,18,184,229,180,176,137,105,151,74,12,150,119,126,101,185,241,9,197,110,198,132,24,240,125,236,
    58,220,77,32,121,238,95,62,215,203,57,72,
]
SM4_FK = [2746333894, 1453994832, 1736282519, 2993693404]
SM4_CK = [
    462357,472066609,943670861,1415275113,1886879365,2358483617,2830087869,3301692121,3773296373,4228057617,404694573,876298825,
    1347903077,1819507329,2291111581,2762715833,3234320085,3705924337,4177462797,337322537,808926789,1280531041,1752135293,2223739545,
    2695343797,3166948049,3638552301,4110090761,269950501,741554753,1213159005,1684763257,
]
SM4_ENCRYPT = 0
SM4_DECRYPT = 1


class Sm4Crypt:
    def __init__(self, padding_mode=3):
        self.sk = [0] * 32
        self.padding_mode = padding_mode
        self.mode = SM4_ENCRYPT

    @classmethod
    def _round_key(cls, ka):
        values = put_uint32_be(ka)
        mapped = [SM4_BOXES_TABLE[values[0]], SM4_BOXES_TABLE[values[1]], SM4_BOXES_TABLE[values[2]], SM4_BOXES_TABLE[values[3]]]
        item = get_uint32_be(mapped)
        return item ^ rotl(item, 13) ^ rotl(item, 23)

    @classmethod
    def _f(cls, x0, x1, x2, x3, rk):
        def calc(ka):
            values = put_uint32_be(ka)
            mapped = [SM4_BOXES_TABLE[values[0]], SM4_BOXES_TABLE[values[1]], SM4_BOXES_TABLE[values[2]], SM4_BOXES_TABLE[values[3]]]
            item = get_uint32_be(mapped)
            return item ^ rotl(item, 2) ^ rotl(item, 10) ^ rotl(item, 18) ^ rotl(item, 24)
        return x0 ^ calc(x1 ^ x2 ^ x3 ^ rk)

    def set_key(self, key, mode):
        raw = bytes_to_list(key)
        mk = [get_uint32_be(raw[0:4]), get_uint32_be(raw[4:8]), get_uint32_be(raw[8:12]), get_uint32_be(raw[12:16])]
        k = [0] * 36
        k[0:4] = xor(mk[0:4], SM4_FK[0:4])
        for i in range(32):
            k[i + 4] = k[i] ^ self._round_key(k[i + 1] ^ k[i + 2] ^ k[i + 3] ^ SM4_CK[i])
            self.sk[i] = k[i + 4]
        self.mode = mode
        if mode == SM4_DECRYPT:
            for i in range(16):
                self.sk[i], self.sk[31 - i] = self.sk[31 - i], self.sk[i]

    def one_round(self, sk, in_put):
        out = []
        ulbuf = [0] * 36
        ulbuf[0] = get_uint32_be(in_put[0:4])
        ulbuf[1] = get_uint32_be(in_put[4:8])
        ulbuf[2] = get_uint32_be(in_put[8:12])
        ulbuf[3] = get_uint32_be(in_put[12:16])
        for idx in range(32):
            ulbuf[idx + 4] = self._f(ulbuf[idx], ulbuf[idx + 1], ulbuf[idx + 2], ulbuf[idx + 3], sk[idx])
        out += put_uint32_be(ulbuf[35])
        out += put_uint32_be(ulbuf[34])
        out += put_uint32_be(ulbuf[33])
        out += put_uint32_be(ulbuf[32])
        return out

    def crypt_cbc(self, iv, input_data):
        iv_list = bytes_to_list(iv)
        source = input_data
        if self.mode == SM4_ENCRYPT:
            source = pkcs7_padding(bytes_to_list(source))
        length = len(source)
        offset = 0
        out = []
        last = [0] * 16
        if self.mode == SM4_ENCRYPT:
            while length > 0:
                block = xor(source[offset:offset + 16], iv_list)
                last = self.one_round(self.sk, block)
                out += last
                iv_list = last
                offset += 16
                length -= 16
            return list_to_bytes(out)
        while length > 0:
            last = self.one_round(self.sk, source[offset:offset + 16])
            out += xor(last, iv_list)
            iv_list = source[offset:offset + 16]
            offset += 16
            length -= 16
        return list_to_bytes(pkcs7_unpadding(out))


def sm2_encrypt_key(data, public_key):
    value = string_to_hex(data).encode()
    cipher = Sm2Crypt(public_key=public_key, mode=1)
    encrypted = cipher.encrypt(value)
    return "04" + encrypted.hex()


def sm4_encrypt(data, key):
    source = data.encode("utf-8")
    raw_key = key.encode("utf-8")
    cipher = Sm4Crypt(padding_mode=3)
    cipher.set_key(raw_key, SM4_ENCRYPT)
    encrypted = cipher.crypt_cbc(raw_key[0:8] + raw_key[-8:], source)
    return base64.b64encode(encrypted).decode()


def sm4_decrypt(data, key):
    source = base64.b64decode(data.encode("utf-8"))
    raw_key = key.encode("utf-8")
    cipher = Sm4Crypt(padding_mode=3)
    cipher.set_key(raw_key, SM4_DECRYPT)
    decrypted = cipher.crypt_cbc(raw_key[0:8] + raw_key[-8:], source)
    return decrypted.decode()


def sm3_sign(data):
    return sm3_hash(bytes_to_list(data.encode("utf-8")))
