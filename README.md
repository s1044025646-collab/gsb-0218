# EAN-13 条码实验服务（本地后端）

使用 TypeScript + Node.js + SQLite 实现的本地 EAN-13 商品条码编码与扫描校验服务，只提供 API 与 CLI，无前端界面。校验位计算与左右编码规则为自行实现，未调用任何现成条码引擎。

## 模块串含义

编码输出为 **95 位模块串**（不含静区），`1` 表示黑模块（条），`0` 表示白模块（空）：

```
101 | 左侧 6 位数字 × 7 位 | 01010 | 右侧 6 位数字 × 7 位 | 101
起始护栏      42 位            中间护栏       42 位           结束护栏
```

- 左侧每位数字按首位数字决定的奇偶模式使用 L（奇）或 G（偶）编码；
- 右侧统一使用 R 编码（L 编码逐位取反）；
- 首位数字不直接编码，由左侧 6 位的奇偶组合（如 `LGLLGG`）恢复。

数字串始终按**字符串**保存与传输，前导零保留。

## 支持边界

- 只处理正向、已对齐的标准 EAN-13 数据；
- 不做图片识别、摄像头采集、模糊纠错、真实商品/厂商查询；
- 校验通过不代表商品或厂商真实存在；
- 错误输入不会被“修复”（不删模块、不补零、不猜数字），只会返回明确的错误码。

## 环境要求

- Windows 本地，Node.js ≥ 22（使用内置 `node:sqlite`，无需 Docker / WSL / 外部服务）；
- 首次使用执行 `npm install`。

## 命令

```bash
npm run build     # 编译 TypeScript 到 dist/
npm test          # 运行自动化测试
npm start         # 启动 HTTP 服务（默认自动选择空闲端口）
npm run demo      # 演示：合法往返 + 改数字 + 坏护栏
```

CLI（`npm run cli -- <子命令>` 或编译后 `node dist/cli.js <子命令>`）：

```
checksum <digits>          计算/验证校验位（12 位算出第 13 位，13 位验证）
encode <digits>            编码为 95 位模块串
decode <modules>           解码 95 位模块串
batch <action:input> ...   批量处理，按原顺序逐条返回
save <name> <digits|modules> <value>   保存命名样例
sample <name> / samples    查询样例
records [limit]            查询处理记录
report [id]                导出 JSON 报告（带 id 时展示保存时的原结果）
serve [--port N]           启动 HTTP 服务（也可用 PORT 环境变量）
demo                       演示
```

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/checksum` | `{ "digits": "4006381333931" }` |
| POST | `/api/encode` | `{ "digits": "590123412345" }` |
| POST | `/api/decode` | `{ "modules": "101..." }` |
| POST | `/api/batch` | `{ "items": [{ "action": "encode", "input": "..." }] }` |
| POST | `/api/samples` | `{ "name", "kind": "digits"\|"modules", "value" }` |
| GET | `/api/samples`、`/api/samples/<name>` | 查询样例 |
| GET | `/api/records?limit=50`、`/api/records/<id>` | 处理记录 |
| GET | `/api/report?id=<id>` | 导出 JSON 报告，重复打开展示原结果 |

失败时 HTTP 状态码为 422（参数缺失为 400），响应体保留原输入。

## 错误码

| 错误码 | 含义 |
| --- | --- |
| `INVALID_DIGIT_LENGTH` | 数字串长度不是 12 或 13 |
| `INVALID_DIGIT_CHARS` | 数字串含非 0-9 字符 |
| `INVALID_MODULE_LENGTH` | 模块串长度不是 95 |
| `INVALID_MODULE_CHARS` | 模块串含非 0/1 字符 |
| `GUARD_DAMAGED` | 起始/中间/结束护栏损坏 |
| `UNKNOWN_DIGIT_PATTERN` | 某段 7 位模块无法识别为数字 |
| `ILLEGAL_PARITY` | 左侧奇偶组合不在标准表中 |
| `CHECKSUM_MISMATCH` | 校验位不符 |

## 失败输出样例

```json
{
  "ok": false,
  "code": "CHECKSUM_MISMATCH",
  "message": "校验位不符：期望 1，实际 2",
  "input": "4006381333932"
}
```

```json
{
  "ok": false,
  "code": "GUARD_DAMAGED",
  "message": "起始/中间/结束护栏损坏",
  "input": "1110001101010011101011110..."
}
```

## 数据目录

SQLite 数据库保存在项目内 `data/ean13.db`，包含 `samples`（命名样例）与 `records`（处理记录）两张表，重启后记录仍可查询。

## 测试

`npm test` 覆盖：已知条码基准（`4006381333931`、`5901234123457`）、手工推导的独立期望模块串、前导零、全部首位数字的奇偶规则、长度不符、非二进制模块、坏校验位、护栏损坏、无法识别的数字模式、非法奇偶组合、混合好坏批次，以及保存记录重启（新连接）后可查。
